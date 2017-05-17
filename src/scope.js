'use strict';

var _ = require('lodash');

function initWatchVal () {}

function isArrayLike(obj) {
	if (_.isNull(obj) || _.isUndefined(obj)) {
		return false;
	}
	var length = obj.length;
	return _.isNumber(length);
}

// A watcher is something that is notified when a change occurs on the scope. 
// You can create a watcher by calling $watch with two arguments, both of which should be functions:
// • A watch function, which specifies the piece of data you’re interested in.
// • A listener function which will be called whenever that data changes.

// The other side of the coin is the $digest function. It iterates over all the watchers that have been
// attached on the scope, and runs their watch and listener functions accordingly.

function Scope() {
	this.$$watchers = [];
	this.$$lastDirtyWatch = null;
	this.$$asyncQueue = [];
	this.$$applyAsyncQueue = [];
	this.$$applyAsyncId = null; // to keep track of whether setTimeout to drain queue has already been scheduled. 
	this.$$postDigestQueue = [];
	this.$root = this; // makes $root available to every scope in the hierarchy (prototypal inheritance chain)
	this.$$children = [];
	this.$$phase = null;
}

Scope.prototype.$watch = function(watchFn, listenerFn, valueEq) {
	var self = this;
	var watcher = {
		watchFn: watchFn,
		listenerFn: listenerFn || function() {},
		valueEq: !!valueEq,
		last: initWatchVal
	};
	this.$$watchers.unshift(watcher);
	this.$root.$$lastDirtyWatch = null;

	return function() {
		var index = self.$$watchers.indexOf(watcher);
		if (index >= 0) {
			self.$$watchers.splice(index, 1);
			self.$root.$$lastDirtyWatch = null; // set to null on removal so lastDirtyWatch does not cause shortCircuit
			// set root of lastDirtyWatch no matter where scope is digested.
		}
	};
};

Scope.prototype.$$digestOnce = function() {
	var dirty;
	var continueLoop = true; // leaving continue loop since it's easier to read
	this.$$everyScope(function(scope) {
		var newValue, oldValue;
		_.forEachRight(scope.$$watchers, function(watcher) {
			try {
				if(watcher) {
					newValue = watcher.watchFn(scope);
					oldValue = watcher.last;
					// if !(false) ==> true, invoke listenerFn, etc.
					if(!scope.$$areEqual(newValue, oldValue, watcher.valueEq)) {
						scope.$root.$$lastDirtyWatch = watcher;
						watcher.last = (watcher.valueEq ? _.cloneDeep(newValue) : newValue);
						watcher.listenerFn(newValue, (oldValue === initWatchVal ? newValue : oldValue), scope);
						dirty = true;
					} else if (scope.$root.$$lastDirtyWatch === watcher) {
						continueLoop = false;
						return false;
					}
				}
			} catch (e) {
				console.log(e);
			}
		});
		return continueLoop;
		// return dirty !== false;
	});
	return dirty;
};

Scope.prototype.$digest = function() {
	var ttl = 10;
	var dirty;
	this.$root.$$lastDirtyWatch = null; // We should always refer to the $$lastDirtyWatch of root, no matter which scope $digest was called on.
	this.$beginPhase('$digest');

	if (this.$root.$$applyAsyncId) {
		clearTimeout(this.$root.$$applyAsyncId);
		this.$$flushApplyAsync();
	}
	
	do {
		while(this.$$asyncQueue.length) {
			try {
				var asyncTask = this.$$asyncQueue.shift();
				asyncTask.scope.$eval(asyncTask.expression);
			} catch (e) {
				console.log(e);
			}
		}
		dirty = this.$$digestOnce();
		// if(dirty && ttl <= 0)
		if((dirty || this.$$asyncQueue.length) && !(ttl--)) {
			this.$clearPhase();
			throw '10 digest iterations reached.';
		}
	} while (dirty || this.$$asyncQueue.length);
	this.$clearPhase();

	while (this.$$postDigestQueue.length) {
		try {
			this.$$postDigestQueue.shift()();
		} catch (e) {
			console.log(e);
		}
	}
};

Scope.prototype.$$areEqual = function(newValue, oldValue, valueEq) {
	if(valueEq) {
		return _.isEqual(newValue, oldValue);
	} else {
		return newValue === oldValue || 
		(typeof newValue === 'number' && typeof oldValue === 'number' && isNaN(newValue) && isNaN(oldValue));
	}
};

// $eval
// takes a function as an argument and immediately executes that
// function giving it the scope itself as an argument. 
// It then returns whatever the function returned. 
Scope.prototype.$eval = function(expr, locals) {
	return expr(this, locals);
};

// $apply 
// takes a function as an argument.
// It executes that function using $eval, and then kickstarts
// the digest cycle by invoking $digest.
// The $digest call is done in a finally block to make sure 
// the digest will happen even if the supplied function throws an exception. 
Scope.prototype.$apply = function(expr) {
	try {
		this.$beginPhase('$apply');
		return this.$eval(expr);
	} finally {
		this.$clearPhase();
		this.$root.$digest();
	}
};

// $evalAsync
// $evalAsync takes a function and schedules it to run 
// later but still during the ongoing digest.
Scope.prototype.$evalAsync = function(expr) {
	var self = this;
	if(!self.$$phase && !self.$$asyncQueue.length) {
		setTimeout(function() {
			if(self.$$asyncQueue.length) {
				self.$root.$digest(); // digest at root scope  
			}
		}, 0);
	}
	self.$$asyncQueue.push({scope: self, expression: expr});
};

Scope.prototype.$beginPhase = function(phase) {
	if(this.$$phase) {
		throw this.$$phase + ' already in progress.';
	}
	this.$$phase = phase;
};

Scope.prototype.$clearPhase = function() {
	this.$$phase = null;
};

Scope.prototype.$$flushApplyAsync = function() {
	while(this.$$applyAsyncQueue.length) {
		try {
			this.$$applyAsyncQueue.shift()();
		} catch (e) {
			console.log(e);
		}
	}
	this.$root.$$applyAsyncId = null;
};

// does not evaluate the given function immediately 
// nor does it launch a digest immediately. 
// it schedules both of these things to happen after a short period of time. 
Scope.prototype.$applyAsync = function(expr) {
	// NOTE: try and refactor like gordon did
	var self = this;
	self.$$applyAsyncQueue.push(function() {
		self.$eval(expr);
	});
	// ensures setTimeout is not run in succession for each applyAsync invocation (therefore the digest is not run multiple times (for each asyncApply)).
	// first applyAsync will equal null and go into setTimeout, next applyAsync will run, push item into queue and /
	// will not run setTimeout. setTimeout for first applyAsync will resume once ready and will proceed into while loop.
	// while loop will run based on queue length and the 1st item in the array is returned and the function is invoked (eval).
	// after while loop is complete, set applyAsyncId to null.   
	if(self.$root.$$applyAsyncId === null) {
		self.$root.$$applyAsyncId = setTimeout(function() {
			self.$apply(_.bind(self.$$flushApplyAsync, self));
		}, 0);
	}
};

Scope.prototype.$$postDigest = function(fn) {
	this.$$postDigestQueue.push(fn);
};

// The $watchGroup function takes several watch functions wrapped in an array, and a single listener
// function. The idea is that when any of the watch functions given in the array detects a change,
// the listener function is invoked. The listener function is given the new and old values of the watches
// wrapped in arrays, in the order of the original watch functions.
Scope.prototype.$watchGroup = function(watchFns, listenerFn) {
	var self = this;
	var newValues = new Array(watchFns.length);
	var oldValues = new Array(watchFns.length);
	var changeReactionScheduled = false;
	var firstRun = true;

	if (watchFns.length === 0) {
		var shouldCall = true;
		self.$evalAsync(function() {
			if (shouldCall) {
				listenerFn(newValues, newValues, self);
			}
		});
		return function() {
			shouldCall = false;
		};
	}

	function watchGroupListener() {
		if (firstRun) {
			firstRun = false;
			listenerFn(newValues, newValues, self);
		} else {
			listenerFn(newValues, oldValues, self);
		}
		changeReactionScheduled = false;
	}

// TODO: NOTES
	var destroyFunctions = _.map(watchFns, function(watchFn, i) {
		return self.$watch(watchFn, function(newValue, oldValue) {
			newValues[i] = newValue;
			oldValues[i] = oldValue;
			if (!changeReactionScheduled) {
				changeReactionScheduled = true;
				self.$evalAsync(watchGroupListener);
			}
		});
	});

	return function() {
		_.forEach(destroyFunctions, function(destroyFunction) {
			destroyFunction();
		});
	};
};


Scope.prototype.$new = function(isolated, parent) {
	var child;
	parent = parent || this; // defaults to this unless specific parent is passed in arg.
	if(isolated) {
		child = new Scope();
		child.$root = parent.$root;
		child.$$asyncQueue = parent.$$asyncQueue;
		child.$$postDigestQueue = parent.$$postDigestQueue;
		child.$$applyAsyncQueue = parent.$$applyAsyncQueue;
	} else {
		var ChildScope = function() {};
		ChildScope.prototype = this;
		child = new ChildScope();
	}
	parent.$$children.push(child);
	child.$$watchers = [];
	child.$$children = [];
	child.$parent = parent;	
	return child;
};

// everyScope accepts a fn as a parameter.
// passes/calls the function w/in the if statement (returns true or false based on if scope is dirty or clean).
// 
Scope.prototype.$$everyScope = function(fn) {
	if(fn(this)) {
		// .every returns true or false based on the callback evaluation.
		return this.$$children.every(function(child) {
			// will return false if scope is clean
			return child.$$everyScope(fn); // returns true or false
		});
	} else {
		return false;
	}
};

// checks if scope has a parent to determine it's not the root scope.
// then finds the current scope from its parent's $$children array and gets the position of the scope
// checks if return value from indexOf is >= 0 to determine if we need to splice the array. (indexOf returns -1 )
// set current scope's watchers to null 
Scope.prototype.$destroy = function () {
	if (this.$parent) {
		var siblings = this.$parent.$$children;
		var indexOfThis = siblings.indexOf(this);
		if (indexOfThis >= 0) {
			siblings.splice(indexOfThis, 1);
		}
	}
	this.$$watchers = null;
};

Scope.prototype.$watchCollection = function (watchFn, listenerFn) {
	var self = this;
	var newValue;
	var oldValue;
	var oldLength;
	var changeCount = 0;

	var internalWatchFn = function (scope) {
		var newLength; 
		newValue = watchFn(scope);
		// check if newValue is an object (array falls within object)
		if (_.isObject(newValue)) {
			// check if array or arrayLike
			if (isArrayLike(newValue)) {
				if (!_.isArray(oldValue)) {
					changeCount++;
					oldValue = [];
				}
				if (newValue.length !== oldValue.length) {
					changeCount++;
					oldValue.length = newValue.length;
				}
				_.forEach(newValue, function (newItem, i) {
					var bothNaN = _.isNaN(newItem) && _.isNaN(oldValue[i]);
					if (!bothNaN && (newItem !== oldValue[i])) {
						changeCount++;
						oldValue[i] = newItem;
					}
				});
			} else {
				// check if object or if an array-like object slips into else statement - must also exclude arrayLike objs.
				// if old value is not currently an object. - (!false) - true.
				if (!_.isObject(oldValue)  || isArrayLike(oldValue)) {
					changeCount++;
					oldValue = {};
					// initiate old length once we've assigned oldValue as an object.
					oldLength = 0;
				}
				// set newLength
				newLength = 0;
				// loop over the attributes of the new object and check whether they have the same values as the old object attributes.
				// also, check to ensure the new/old object does not have NaN as an attribute. 
				// (since NaN !== NaN, it causes an infinite digest).
				_.forOwn(newValue, function (newVal, key) {
					newLength++;
					if (oldValue.hasOwnProperty(key)) {
						var bothNaN = _.isNaN(newVal) && _.isNaN(oldValue[key]);
						if (!bothNaN && oldValue[key] !== newVal) {
							changeCount++;
							oldValue[key] = newVal;
						}
					} else {
						changeCount++;
						oldLength++;
						oldValue[key] = newVal;
					}	
				});

				// loop over the attributes of the old object and see if they're still present in the new object.
				// if they're not, they no longer exist and we remove them.
				if (oldLength > newLength) {
					changeCount++;
					_.forOwn(oldValue, function (oldVal, key) {
						if (!newValue.hasOwnProperty(key)) {
							oldLength--;
							delete oldValue[key];
						}
					});
				}
			}
		} else {
			// use .$$areEqual to prevent NaN's (never equal) from throwing 'TTL' error in digest.
			// take opposite of whatever is returned from .$$areEqual
			if (!self.$$areEqual(newValue, oldValue, false)) {
				changeCount++;
			}
			oldValue = newValue;
		}
		return changeCount;
	};

	var internalListenerFn = function () {
		listenerFn(newValue, oldValue, self);
	};

	return this.$watch(internalWatchFn, internalListenerFn);
};



module.exports = Scope;
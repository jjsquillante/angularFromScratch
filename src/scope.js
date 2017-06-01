'use strict';

var _ = require('lodash');

function initWatchVal () {}

/** 
 * @function isArrayLike
 *
 * checks if an 'array-like' object is present and treats it like an array. 
 * (array like ie. the DOM's NodeList)
 * returns false if the value passed as argument is null or undefined 
 * returns false if object has a property set as 'length' (not array-like) - in this case, will check if length is a number or length - 1 is also w/in obj property list.
 * returns true if length of obj === 0 || (length is a number AND (length - 1) is a property key in obj).
 *
 * @param {*} - will be determined if the arg is an object or array-like object by checking if the arg has a length.
 * @return {Boolean} will return true or false based on the criteria evaluated.
*/

function isArrayLike(obj) {
	if (_.isNull(obj) || _.isUndefined(obj)) {
		return false;
	}
	var length = obj.length;
	// checks to ensure argument is an array or array-like obj with length property, not a
	// property named 'length' in an object. determines if is an array or array like
	// by checking if the (length value - 1) key/position also exists in the array.
	// will return true for array lengths that === 0. (object length will be undefined)
	return length === 0 || (_.isNumber(length) && length > 0 && (length - 1) in obj);
}

/**
 * Scope
 *
 * Represents a JavaScript object that, among other things, stores each watcher object in an array. 
 *
 * @example 
 * function Scope () { this.$$watchers = []; }
 * var scope = new Scope();
 * 
 * @constructor
 * @returns {Object} a reference to the Object constructor
*/

function Scope() {
	this.$$watchers = [];
	this.$$lastDirtyWatch = null;
	this.$$asyncQueue = [];
	this.$$applyAsyncQueue = [];
	this.$$applyAsyncId = null; // to keep track of whether setTimeout to drain queue has already been scheduled. 
	this.$$postDigestQueue = [];
	this.$root = this; // makes $root available to every scope in the hierarchy (prototypal inheritance chain)
	this.$$children = [];
	this.$$listeners = {};
	this.$$phase = null;
}

/**
 * @function $watch
 *
 * A watcher is something that is notified when a change occurs on the scope.
 * You can create a watcher by calling $watch with two arguments, both of which should be functions:
 * • A watch function, which specifies the piece of data you’re interested in.
 * • A listener function which will be called whenever that data changes.
 *
 * @param {function} watcherFn Function will be called as the first argument.
 * @param {function} listenerFn Function will be called as the second argument.
 * @param {Boolean} valueEq is a Boolean flag to determine whether to deep clone and apply 'value based dirty checking' /
 *  • (if object or array, iterate through values contained and check if there's a difference).
 * 
 * @return {Function} to call on later if we would like to delete the watcher.
*/ 

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

/**
 * @function $$digestOnce
 * 
 * $$digestOnce will iterate over all registered watchers and call their listener function. 
 * $$digestOnce implements `dirty checking` where, only if the values specified by the watch function have changed, 
 * we call the listener function
 * Doing multiple passes is the only way to notice changes applied for watchers that rely on other watchers.
 * If on the first change the flag is marked true, all watchers will run for a second time - this goes on until each watch is stable. 
 * 
 * @return {Boolean} flag returned based on the watcher.
 * if newValue and oldValue do not match, boolean flag will be set as true and we'll 
 * return true to continue do/while loop within $digest.
 * 
*/

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

/**
 * @function $digest
 *
 * digest is the outerloop for $$digestOnce, calling $$digestOnce (returns boolean) /
 * as long as changes keep occurring.
 * 
 * 
*/
Scope.prototype.$digest = function() {
	var ttl = 10;
	var dirty;
	/**
	 * When $digest is called, reset $lastDirtyWatch.
	 * Prevents unecessary shortCircuit when called within a watch Function.
	 * Refers to the $$lastDirtyWatch of root, no matter which scope $digest is called on.
	*/ 
	this.$root.$$lastDirtyWatch = null;

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

/**
 * @function $$areEqual
 * 
 * TODO
 *
 *
 *
*/

Scope.prototype.$$areEqual = function(newValue, oldValue, valueEq) {
	if(valueEq) {
		return _.isEqual(newValue, oldValue);
	} else {
		return newValue === oldValue || 
		(typeof newValue === 'number' && typeof oldValue === 'number' && isNaN(newValue) && isNaN(oldValue));
	}
};

/**
 * $eval
 *
 * Evaluates an expression in the context of a scope.
 * $eval takes a function as an argument and immediately executes the function, passing the scope as an argument.
 * 
 * @example
 * scope.aValue = 42;
 * var expr = function (scope, locals) { return scope.aValue + locals; };
 * scope.$eval(expr, 2) === 44;
 *
 * @param {function} expr Function that will be called with scope as first argument.
 * @param [locals] Optional arguments that are passed as-is into expr as second argument.
 * @returns {*} Result of evaluating expr.
*/

Scope.prototype.$eval = function(expr, locals) {
	return expr(this, locals);
};

// $apply 
// takes a function as an argument.
// It executes that function using $eval, and then kickstarts
// the digest cycle by invoking $digest.
// The $digest call is done in a finally block to make sure 
// the digest will happen even if the supplied function throws an exception. 

/**
 * @function $apply
 *
 * TODO
 *
 * @return
 *
*/
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

/**
 * @function $evalAsync
 *
 * TODO
 *
 *
 *
*/
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

/**
 * @function $beginPhase
 *
 * string attribute in the scope that stores information about what’s currently going on.
 * helps asynchronous functions identify whether a $digest is already ongoing.
 * will throw a message is the string is not null.
 *
 * @param {string} set parameter phase to the attribute $$phase in Scope.
 *  
*/
Scope.prototype.$beginPhase = function(phase) {
	if(this.$$phase) {
		throw this.$$phase + ' already in progress.';
	}
	this.$$phase = phase;
};

/**
 * @function $clearPhase
 *
 * resets $$phase attribute on scope back to null.
 *
 *
*/

Scope.prototype.$clearPhase = function() {
	this.$$phase = null;
};

/**
 * @function $$flushApplyAsync
 *
 * TODO
 *
 *
*/

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

/**
 * @function $applyAsync
 *
 * TODO
 *
 *
*/

Scope.prototype.$applyAsync = function(expr) {
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

/**
 * @function $$postDigest
 *
 * TODO
 *
 *
*/

Scope.prototype.$$postDigest = function(fn) {
	this.$$postDigestQueue.push(fn);
};

// The $watchGroup function takes several watch functions wrapped in an array, and a single listener
// function. The idea is that when any of the watch functions given in the array detects a change,
// the listener function is invoked. The listener function is given the new and old values of the watches
// wrapped in arrays, in the order of the original watch functions.

/**
 * @function $watchGroup
 *
 * TODO
 *
 *
*/

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

/**
 * @function $new
 *
 * Creates a child scope for the current scope and returns it.
 * Uses JavaScript's Object inheritance - when you create a child scope, its parent will be made its prototype.
 * Create a constructor function for the child (ChildScope), set the Current Scope as the prototype of ChildScope. (left of the dot rule)
 * Then, create a new object using ChildScope constructor and return it.
 *
 * @example
 * var parent = new Scope();
 * var child = parent.$new();
 * Object.getPrototypeOf(child) === parent // true
 * 
 * @param {boolean} if set to true, we isolate the current scope and create a new object using the root Scope constructor.
 * @param {Object} specifies the Object to set as the prototype. Will default to the 'left of the dot rule', if undefined.
 * @returns {Object} returns a new object created from the constructor function.
*/

Scope.prototype.$new = function(isolated, parent) {
	var child;
	parent = parent || this; // defaults to `this` unless specific parent is passed in arg.
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
	child.$$listeners = {};
	child.$$children = [];
	child.$parent = parent;	
	return child;
};

// everyScope accepts a fn as a parameter.
// passes/calls the function w/in the if statement (returns true or false based on if scope is dirty or clean).
// 


/**
 * @function $everyScope
 * 
 * $everyScope recursively runs watches throughout the scope hierarchy. (for every scope in a parents 'children' array, will look to see if there are watchers set.)
 * executes an arbitrary function once for each scope in the hierarchy until the function returns a falsy value. 
 * 
 * 
 * var parent = new Scope();
 * var child = parent.$new();
 * parent.aValue = 'abc'; 
 * child.$watch(function (scope) { return scope.aValue}, function (newValue, oldValue, scope) { scope.aValueWas = newValue; });
 * parent.$digest();
 * expect child.aValueWas === 'abc'; // true;
 * 
 * @param {function} fn executes once for each scope in the hiearchy until the function returns a falsy value.
 * @returns {boolean} returns true or false if scope is dirty (true to continue loop) or false if clean
*/

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

/**
 * @function $destroy
 *
 * TODO
 *
 *
*/

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

/**
 * @function $watchCollection
 *
 * TODO
 *
 *
*/

Scope.prototype.$watchCollection = function (watchFn, listenerFn) {
	var self = this;
	var newValue;
	var oldValue;
	var oldLength;
	var veryOldValue;
	var trackVeryOldValue = (listenerFn.length > 1);
	var changeCount = 0;
	var firstRun = true;

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
		if (firstRun) {
			listenerFn(newValue, newValue, self);
			firstRun = false;
		} else {
			listenerFn(newValue, veryOldValue, self);
		}

		if (trackVeryOldValue) {
			veryOldValue = _.clone(newValue);
		}
	};

	return this.$watch(internalWatchFn, internalListenerFn);
};

/* @function $on
 *
 * Should store the listener somewhere so that it can find it later when events are fired. 
 * For storage we’ll put an object in the attribute $$listeners. 
 * The object’s keys will be event names, and the values will be arrays 
 * holding the listener functions registered for a particular event. 
 * 
 * The function takes two arguments: 
 *  1. The name of the event of interest
 *  2. The listener (subscriber) function that will get called when that event occurs.
 * 
 * Listeners registered through $on will receive both emitted and broadcasted events.
 * 
 * @param {string} // publisher
 * @param {function} // subscriber
 * @return {*} 
**/

Scope.prototype.$on = function (eventName, listener) {
	var listeners = this.$$listeners[eventName];

	if (!listeners) {
		this.$$listeners[eventName] = listeners = [];
	}
	listeners.push(listener);
};

Scope.prototype.$emit = function (eventName) {
	var listeners = this.$$listeners[eventName] || [];

	_.forEach(listeners, function (listener) {
		listener();
	});
};

Scope.prototype.$broadcast = function (eventName) {
	var listeners = this.$$listeners[eventName] || [];

	_.forEach(listeners, function (listener) {
		listener();
	});
};




module.exports = Scope;
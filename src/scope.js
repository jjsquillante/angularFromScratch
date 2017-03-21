'use strict';

var _ = require('lodash');

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
	this.$$phase = null;
}

function initWatchVal() {}

Scope.prototype.$watch = function(watchFn, listenerFn, valueEq) {
	var self = this;
	var watcher = {
		watchFn: watchFn,
		listenerFn: listenerFn || function() {},
		valueEq: !!valueEq,
		last: initWatchVal
	};
	this.$$watchers.unshift(watcher);
	this.$$lastDirtyWatch = null;

	return function() {
		var index = self.$$watchers.indexOf(watcher);
		if (index >= 0) {
			self.$$watchers.splice(index, 1);
			self.$$lastDirtyWatch = null; // set to null on removal so lastDirtyWatch does not cause shortCircuit
		}
	};
};

Scope.prototype.$$digestOnce = function() {
	var self = this;
	var newValue, oldValue, dirty;
	_.forEachRight(this.$$watchers, function(watcher) {
		try {
			if(watcher) {
				newValue = watcher.watchFn(self);
				oldValue = watcher.last;
				// if !(false) ==> true, invoke listenerFn, etc.
				if(!self.$$areEqual(newValue, oldValue, watcher.valueEq)) {
					self.$$lastDirtyWatch = watcher;
					watcher.last = (watcher.valueEq ? _.cloneDeep(newValue) : newValue);
					watcher.listenerFn(newValue, (oldValue === initWatchVal ? newValue : oldValue), self);
					dirty = true;
				} else if (self.$$lastDirtyWatch === watcher) {
					return false;
				}
			}
		} catch (e) {
			console.log(e);
		}
	});
	return dirty;
};

Scope.prototype.$digest = function() {
	var ttl = 10;
	var dirty;
	this.$$lastDirtyWatch = null;
	this.$beginPhase('$digest');

	if (this.$$applyAsyncId) {
		clearTimeout(this.$$applyAsyncId);
		this.$$flushApplyAsync();
	}
	
	do {
		while(this.$$asyncQueue.length) {
			var asyncTask = this.$$asyncQueue.shift();
			asyncTask.scope.$eval(asyncTask.expression);
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
		this.$$postDigestQueue.shift()();
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

Scope.prototype.$eval = function(expr, locals) {
	return expr(this, locals);
};

Scope.prototype.$apply = function(expr) {
	try {
		this.$beginPhase('$apply');
		return this.$eval(expr);
	} finally {
		this.$clearPhase();
		this.$digest();
	}
};

Scope.prototype.$evalAsync = function(expr) {
	var self = this;
	if(!self.$$phase && !self.$$asyncQueue.length) {
		setTimeout(function() {
			if(self.$$asyncQueue.length) {
				self.$digest();
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
		this.$$applyAsyncQueue.shift()();
	}
	this.$$applyAsyncId = null;
};

// does not evaluate the given function immediately 
// nor does it launch a digest immediately. 
// it schedules both of these things to happen after a short period of time. 
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
	if(self.$$applyAsyncId === null) {
		self.$$applyAsyncId = setTimeout(function() {
			self.$apply(_.bind(self.$$flushApplyAsync, self));
		}, 0);
	}
};

Scope.prototype.$$postDigest = function(fn) {
	this.$$postDigestQueue.push(fn);
};




module.exports = Scope;
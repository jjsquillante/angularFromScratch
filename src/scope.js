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
}

function initWatchVal() {}

Scope.prototype.$watch = function(watchFn, listenerFn) {
	var watcher = {
		watchFn: watchFn,
		listenerFn: listenerFn || function() {},
		last: initWatchVal
	};
	this.$$watchers.push(watcher);
	this.$$lastDirtyWatch = null;
};

Scope.prototype.$$digestOnce = function() {
	var self = this;
	var newValue, oldValue, dirty;
	_.forEach(this.$$watchers, function(watcher) {
		newValue = watcher.watchFn(self);
		oldValue = watcher.last;
		if(newValue !== oldValue) {
			self.$$lastDirtyWatch = watcher;
			watcher.last = newValue;
			watcher.listenerFn(newValue, (oldValue === initWatchVal ? newValue : oldValue), self);
			dirty = true;
		} else if (self.$$lastDirtyWatch === watcher) {
			return false;
		}	
	});
	return dirty;
};

Scope.prototype.$digest = function() {
	var ttl = 10;
	var dirty;
	this.$$lastDirtyWatch = null;
	do {
		dirty = this.$$digestOnce();
		if(dirty && !(ttl--)) {
			throw '10 digest iterations reached.';
		}
	} while (dirty);
};


module.exports = Scope;
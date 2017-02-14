'use strict';

var Scope = require('../src/scope');

describe('Scope', function() {

	it('can be constructed and used as an object', function() {
		var scope = new Scope();
		scope.aProperty = 1;

		expect(scope.aProperty).toBe(1);
	});

	describe('digest', function() {
		var scope;

		beforeEach(function() {
			scope = new Scope();
		});

		it('calls the listener function of a watch on first $digest.', function() {
			var watchFn = function() { return 'watch!'; };
			var listenerFn = jasmine.createSpy();

			scope.$watch(watchFn, listenerFn);

			scope.$digest();

			expect(listenerFn).toHaveBeenCalled();
		});
	});

});














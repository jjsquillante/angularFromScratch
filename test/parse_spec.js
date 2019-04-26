'use-strict';

var parse = require('../src/parse');

describe('parse', function () {
		it('can parse an integer', function () {
			var fn = parse('42');
			expect(fn).toBeDefined();
			expect(fn()).toBe(42);
		});
		it('can parse a floating point number', function () {
			var fn = parse('4.2');
			console.log(fn.toString());
			expect(fn()).toBe(4.2);
		});
		it('can parse a floating point number without an integer part.', function () {
			var fn = parse('.42');
			expect(fn()).toBe(0.42);
		});
});
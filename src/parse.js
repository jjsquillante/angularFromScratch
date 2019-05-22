'use strict';
var _ = require('lodash');
var ESCAPES = {
	'n': '\n',
	'f': '\f',
	'r': '\r',
	't': '\t',
	'v': '\v',
	'\'': '\'',
	'"': '"'
};

// chapter 6.

function Lexer() {}

// Executes tokenization.
Lexer.prototype.lex = function (text) {
	this.text = text;
	this.index = 0;
	this.ch = undefined;
	this.tokens = [];

	while (this.index < this.text.length) {
		this.ch = this.text.charAt(this.index);
		if (this.isNumber(this.ch) || (this.is('.') && this.isNumber(this.peek()))) {
			this.readNumber();
		} else if (this.is('\'"')) {
			this.readString(this.ch);
			// reserved character tokens to look for.
		} else if (this.is('[],{}:')) {
			this.tokens.push({
				text: this.ch
			});
			this.index++;
		} else if (this.isIdent(this.ch)) {
			this.readIdent();
		} else if (this.isWhiteSpace(this.ch)) {
			this.index++;
		} else {
			throw 'Unexpected next character: ' + this.ch;
		}
	}
	return this.tokens;
};

Lexer.prototype.isNumber = function (ch) {
	return '0' <= ch && ch <= '9';
};

Lexer.prototype.readNumber = function () {
	var number = '';
	while (this.index < this.text.length) {
		var ch = this.text.charAt(this.index).toLowerCase();
		if (ch === '.' || this.isNumber(ch)) {
			number += ch;
		} else {
			var nextCh = this.peek();
			var prevCh = number.charAt(number.length - 1);
			if (ch === 'e' && this.isExpOperator(nextCh)) {
				number += ch;
			} else if (this.isExpOperator(ch) && prevCh === 'e' && nextCh && this.isNumber(nextCh)) {
				number += ch;
			} else if (this.isExpOperator(ch) && prevCh === 'e' && (!nextCh || !this.isNumber(nextCh))) {
				throw 'Invalid exponent';
			} else {
				break;
			}
		}
		this.index++;
	}
	this.tokens.push({
		text: number,
		value: Number(number)
	});
};

Lexer.prototype.peek = function () {
	return this.index < this.text.length - 1 ?
		this.text.charAt(this.index + 1) :
		false;
};

Lexer.prototype.isExpOperator = function (ch) {
	return ch === '-' || ch === '+' || this.isNumber(ch);
};

Lexer.prototype.readString = function (quote) {
	// skip forward past the \' or \" denoting the beginning of a string.
	this.index++;
	var string = '';
	var _escape = false;
	while (this.index < this.text.length) {
		var ch = this.text.charAt(this.index);
		if (_escape) {
			if (ch === 'u') {
				var hex = this.text.substring(this.index + 1, this.index + 5);
				if (!hex.match(/[\da-f]{4}/i)) {
					throw 'Invalid unicode escape';
				}
				this.index += 4;
				string += String.fromCharCode(parseInt(hex, 16));
			} else {
				var replacement = ESCAPES[ch];
				if (replacement) {
					string += replacement;
				} else {
					string += ch;
				}
			}
			_escape = false;
		} else if (ch === quote) {
			this.index++;
			this.tokens.push({
				text: string,
				value: string,
			});
			return;
		} else if (ch === '\\') {
			_escape = true;
		} else {
			string += ch;
		}
		this.index++;
	}
	throw 'Unmatched quote';
};

Lexer.prototype.isIdent = function (ch) {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
		ch === '_' || ch === '$';
};

Lexer.prototype.readIdent = function () {
	var text = '';
	while (this.index < this.text.length) {
		var ch = this.text.charAt(this.index);
		if (this.isIdent(ch) || this.isNumber(ch)) {
			text += ch;
		} else {
			break;
		}
		this.index++;
	}
	var token = {
		text: text,
		identifier: true
	};
	this.tokens.push(token);
};

Lexer.prototype.isWhiteSpace = function(ch) {
	return ch === ' ' || ch === '\r' || ch === '\t' ||
		ch === '\n' || ch === '\v' || ch === '\u00A0';
};

Lexer.prototype.is = function (chs) {
	return chs.indexOf(this.ch) >= 0;
};

function AST(lexer) {
	this.lexer = lexer;
}

// AST building will be done here.
AST.Program = 'Program';
AST.Literal = 'Literal';
AST.ArrayExpression = 'ArrayExpression';
AST.ObjectExpression = 'ObjectExpression';
AST.Property = 'Property';
AST.Identifier = 'Identifier';

AST.prototype.constants = {
	'null': { type: AST.Literal, value: null },
	'true': { type: AST.Literal, value: true },
	'false': { type: AST.Literal, value: false }
};

AST.prototype.ast = function (text) {
	this.tokens = this.lexer.lex(text);
	return this.program();
};

AST.prototype.program = function () {
	return { type: AST.Program, body: this.primary() };
};

AST.prototype.primary = function () {
	if (this.expect('[')) {
		return this.arrayDeclaration();
	} else if (this.expect('{')) {
		return this.object();
	} else if (this.constants.hasOwnProperty(this.tokens[0].text)) {
		return this.constants[this.consume().text];
	} else if (this.peek().identifier) {
		return this.identifier();
	} else {
		return this.constant();
	}
};

AST.prototype.constant = function () {
	return { type: AST.Literal, value: this.consume().value };
};

AST.prototype.expect = function (e) {
	var token = this.peek(e);
	if (token) {
		return this.tokens.shift();
	}
};

AST.prototype.arrayDeclaration = function () {
	var elements = [];
	if (!this.peek(']')) {
		do {
			if (this.peek(']')) {
				break;
			}
			elements.push(this.primary());
		} while (this.expect(','));
	}
	this.consume(']');
	return { type: AST.ArrayExpression, elements: elements };
};

AST.prototype.consume = function (e) {
	var token = this.expect(e);
	if (!token) {
		throw 'Unexpected. Expecting: ' + e;
	}
	return token;
};

AST.prototype.peek = function (e) {
	if (this.tokens.length > 0) {
		var text = this.tokens[0].text;
		if (text === e || !e) {
			return this.tokens[0];
		}
	}
};

AST.prototype.object = function () {
	var properties = [];
	if (!this.peek('}')) {
		do {
			var property = { type: AST.Property };
			if (this.peek().identifier) {
				property.key = this.identifier();
			} else {
				property.key = this.constant();
			}
			this.consume(':');
			property.value = this.primary();
			properties.push(property);
		} while (this.expect(','));
	}
	this.consume('}');
	return { type: AST.ObjectExpression, properties: properties };
};

AST.prototype.identifier = function () {
	return { type: AST.Identifier, name: this.consume().text };
};

function ASTCompiler (astBuilder) {
	this.astBuilder = astBuilder;
}
// Compiler
// AST compilation will be done here.
ASTCompiler.prototype.compile = function (text) {
	var ast = this.astBuilder.ast(text);
	this.state = { body: [], nextId: 0,  vars: [] };
	this.recurse(ast);
	 /* jshint -W054 */
	 return new Function('s', 
	 	(this.state.vars.length ?
	 		'var ' + this.state.vars.join(',') + ';' :
	 		''
	 	) + this.state.body.join(''));
	 /* jshint +W054 */
};

ASTCompiler.prototype.recurse = function (ast) {
	switch (ast.type) {
		case AST.Program:
			this.state.body.push('return ', this.recurse(ast.body), ';');
			break;
		case AST.Literal:
			return this.escape(ast.value);
		case AST.ArrayExpression:
			var elements = _.map(ast.elements, _.bind(function (element) {
				return this.recurse(element);
			}, this));
			return '['+ elements.join(',') + ']';
		case AST.ObjectExpression:
			var properties = _.map(ast.properties, _.bind(function(property) {
				var key = property.key.type === AST.Identifier ?
					property.key.name :
					this.escape(property.key.value);
				var value = this.recurse(property.value);
				return key + ':' + value;
			}, this));
			return '{' + properties.join(',') + '}';
		case AST.Identifier:
			var intoId = this.nextId();
			this.if_('s', this.assign(intoId, this.nonComputedMember('s', ast.name)));
			return intoId;
	}
};

ASTCompiler.prototype.escape = function (value) {
	if (_.isString(value)) {
		return '\'' + value.replace(this.stringEscapeRegex, this.stringEscapeFn) + '\'';
	} else if (_.isNull(value)) {
		return 'null';
	} else {
		return value;
	}
};

ASTCompiler.prototype.stringEscapeRegex = /[^ a-z0-9]/gi;

ASTCompiler.prototype.stringEscapeFn = function (c) {
	return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
};

ASTCompiler.prototype.nonComputedMember = function (left, right) {
	return '(' + left + ').' + right;
};

ASTCompiler.prototype.if_ = function (test, consequent) {
	this.state.body.push('if(', test, '){', consequent, '}');
};

ASTCompiler.prototype.assign = function (id, value) {
	return id + '=' + value + ';';
};

ASTCompiler.prototype.nextId = function () {
	var id = 'v' + (this.state.nextId++);
	this.state.vars.push(id);
	return id;
};

function Parser(lexer) {
	this.lexer = lexer;
	this.ast = new AST(this.lexer);
	this.astCompiler = new ASTCompiler(this.ast);
}

Parser.prototype.parse = function (text) {
	return this.astCompiler.compile(text);
};

function parse(expr) {
	var lexer = new Lexer();
	var parser = new Parser(lexer);
	return parser.parse(expr);
}

module.exports = parse;

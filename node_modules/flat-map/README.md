#flat-map
[![Build Status](https://travis-ci.org/rdy/flat-map.svg)](https://travis-ci.org/rdy/flat-map)

A flat map implementation for node streams

##Installation
`npm install flat-map`

##Usage

When the callback data is already flat passes it maps it normally:
```javascript
  var es = require('event-stream');
  var flatMap = require('flat-map');
  es.readArray([1, 2, 3, 4, 5])
    .pipe(flatMap(function(data, callback) { callback(null, data.split(/\s/); }));
  // [1, 2, 3, 4, 5]    
```

When the callback data is an array it flattens and maps it accordingly:
```javascript
  var es = require('event-stream');
  var flatMap = require('flat-map');
  es.readArray('one two', 'three', 'four five')
    .pipe(flatMap(function(data, callback) { callback(null, data.split(/\s/); });
  // ['one', 'two', 'three', 'four', 'five']    
```

When the callback data is a stream it flattens and maps it accordingly:
```javascript
  var es = require('event-stream');
  var flatMap = require('flat-map');
  es.readArray('one two', 'three', 'four five')
    .pipe(flatMap(function(data, callback) { callback(null, es.readArray(data.split(/\s+/))) });
  // ['one', 'two', 'three', 'four', 'five']    
```
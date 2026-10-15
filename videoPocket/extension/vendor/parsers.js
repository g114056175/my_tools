var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from2, except, desc) => {
  if (from2 && typeof from2 === "object" || typeof from2 === "function") {
    for (let key of __getOwnPropNames(from2))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from2[key], enumerable: !(desc = __getOwnPropDesc(from2, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// work/browser-build/node_modules/global/window.js
var require_window = __commonJS({
  "work/browser-build/node_modules/global/window.js"(exports, module) {
    var win;
    if (typeof window !== "undefined") {
      win = window;
    } else if (typeof global !== "undefined") {
      win = global;
    } else if (typeof self !== "undefined") {
      win = self;
    } else {
      win = {};
    }
    module.exports = win;
  }
});

// work/browser-build/node_modules/@xmldom/xmldom/lib/conventions.js
var require_conventions = __commonJS({
  "work/browser-build/node_modules/@xmldom/xmldom/lib/conventions.js"(exports) {
    "use strict";
    function find(list, predicate, ac) {
      if (ac === void 0) {
        ac = Array.prototype;
      }
      if (list && typeof ac.find === "function") {
        return ac.find.call(list, predicate);
      }
      for (var i = 0; i < list.length; i++) {
        if (Object.prototype.hasOwnProperty.call(list, i)) {
          var item = list[i];
          if (predicate.call(void 0, item, i, list)) {
            return item;
          }
        }
      }
    }
    function freeze(object, oc) {
      if (oc === void 0) {
        oc = Object;
      }
      return oc && typeof oc.freeze === "function" ? oc.freeze(object) : object;
    }
    function assign(target, source) {
      if (target === null || typeof target !== "object") {
        throw new TypeError("target is not an object");
      }
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
      return target;
    }
    var MIME_TYPE = freeze({
      /**
       * `text/html`, the only mime type that triggers treating an XML document as HTML.
       *
       * @see DOMParser.SupportedType.isHTML
       * @see https://www.iana.org/assignments/media-types/text/html IANA MimeType registration
       * @see https://en.wikipedia.org/wiki/HTML Wikipedia
       * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString MDN
       * @see https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-domparser-parsefromstring WHATWG HTML Spec
       */
      HTML: "text/html",
      /**
       * Helper method to check a mime type if it indicates an HTML document
       *
       * @param {string} [value]
       * @returns {boolean}
       *
       * @see https://www.iana.org/assignments/media-types/text/html IANA MimeType registration
       * @see https://en.wikipedia.org/wiki/HTML Wikipedia
       * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString MDN
       * @see https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-domparser-parsefromstring 	 */
      isHTML: function(value) {
        return value === MIME_TYPE.HTML;
      },
      /**
       * `application/xml`, the standard mime type for XML documents.
       *
       * @see https://www.iana.org/assignments/media-types/application/xml IANA MimeType registration
       * @see https://tools.ietf.org/html/rfc7303#section-9.1 RFC 7303
       * @see https://en.wikipedia.org/wiki/XML_and_MIME Wikipedia
       */
      XML_APPLICATION: "application/xml",
      /**
       * `text/html`, an alias for `application/xml`.
       *
       * @see https://tools.ietf.org/html/rfc7303#section-9.2 RFC 7303
       * @see https://www.iana.org/assignments/media-types/text/xml IANA MimeType registration
       * @see https://en.wikipedia.org/wiki/XML_and_MIME Wikipedia
       */
      XML_TEXT: "text/xml",
      /**
       * `application/xhtml+xml`, indicates an XML document that has the default HTML namespace,
       * but is parsed as an XML document.
       *
       * @see https://www.iana.org/assignments/media-types/application/xhtml+xml IANA MimeType registration
       * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocument WHATWG DOM Spec
       * @see https://en.wikipedia.org/wiki/XHTML Wikipedia
       */
      XML_XHTML_APPLICATION: "application/xhtml+xml",
      /**
       * `image/svg+xml`,
       *
       * @see https://www.iana.org/assignments/media-types/image/svg+xml IANA MimeType registration
       * @see https://www.w3.org/TR/SVG11/ W3C SVG 1.1
       * @see https://en.wikipedia.org/wiki/Scalable_Vector_Graphics Wikipedia
       */
      XML_SVG_IMAGE: "image/svg+xml"
    });
    var NAMESPACE = freeze({
      /**
       * The XHTML namespace.
       *
       * @see http://www.w3.org/1999/xhtml
       */
      HTML: "http://www.w3.org/1999/xhtml",
      /**
       * Checks if `uri` equals `NAMESPACE.HTML`.
       *
       * @param {string} [uri]
       *
       * @see NAMESPACE.HTML
       */
      isHTML: function(uri) {
        return uri === NAMESPACE.HTML;
      },
      /**
       * The SVG namespace.
       *
       * @see http://www.w3.org/2000/svg
       */
      SVG: "http://www.w3.org/2000/svg",
      /**
       * The `xml:` namespace.
       *
       * @see http://www.w3.org/XML/1998/namespace
       */
      XML: "http://www.w3.org/XML/1998/namespace",
      /**
       * The `xmlns:` namespace
       *
       * @see https://www.w3.org/2000/xmlns/
       */
      XMLNS: "http://www.w3.org/2000/xmlns/"
    });
    var nameStartChar = /[A-Z_a-z\xC0-\xD6\xD8-\xF6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
    var nameChar = new RegExp("[\\-\\.0-9" + nameStartChar.source.slice(1, -1) + "\\u00B7\\u0300-\\u036F\\u203F-\\u2040]");
    var tagNamePattern = new RegExp("^" + nameStartChar.source + nameChar.source + "*(?::" + nameStartChar.source + nameChar.source + "*)?$");
    exports.assign = assign;
    exports.find = find;
    exports.freeze = freeze;
    exports.MIME_TYPE = MIME_TYPE;
    exports.NAMESPACE = NAMESPACE;
    exports.nameStartChar = nameStartChar;
    exports.nameChar = nameChar;
    exports.tagNamePattern = tagNamePattern;
  }
});

// work/browser-build/node_modules/@xmldom/xmldom/lib/dom.js
var require_dom = __commonJS({
  "work/browser-build/node_modules/@xmldom/xmldom/lib/dom.js"(exports) {
    var conventions = require_conventions();
    var find = conventions.find;
    var NAMESPACE = conventions.NAMESPACE;
    var tagNamePattern = conventions.tagNamePattern;
    function notEmptyString(input) {
      return input !== "";
    }
    function splitOnASCIIWhitespace(input) {
      return input ? input.split(/[\t\n\f\r ]+/).filter(notEmptyString) : [];
    }
    function orderedSetReducer(current, element) {
      if (!current.hasOwnProperty(element)) {
        current[element] = true;
      }
      return current;
    }
    function toOrderedSet(input) {
      if (!input) return [];
      var list = splitOnASCIIWhitespace(input);
      return Object.keys(list.reduce(orderedSetReducer, {}));
    }
    function arrayIncludes(list) {
      return function(element) {
        return list && list.indexOf(element) !== -1;
      };
    }
    function copy(src, dest) {
      for (var p in src) {
        if (Object.prototype.hasOwnProperty.call(src, p)) {
          dest[p] = src[p];
        }
      }
    }
    function _extends2(Class, Super) {
      var pt = Class.prototype;
      if (!(pt instanceof Super)) {
        let t2 = function() {
        };
        var t = t2;
        ;
        t2.prototype = Super.prototype;
        t2 = new t2();
        copy(pt, t2);
        Class.prototype = pt = t2;
      }
      if (pt.constructor != Class) {
        if (typeof Class != "function") {
          console.error("unknown Class:" + Class);
        }
        pt.constructor = Class;
      }
    }
    var NodeType = {};
    var ELEMENT_NODE = NodeType.ELEMENT_NODE = 1;
    var ATTRIBUTE_NODE = NodeType.ATTRIBUTE_NODE = 2;
    var TEXT_NODE = NodeType.TEXT_NODE = 3;
    var CDATA_SECTION_NODE = NodeType.CDATA_SECTION_NODE = 4;
    var ENTITY_REFERENCE_NODE = NodeType.ENTITY_REFERENCE_NODE = 5;
    var ENTITY_NODE = NodeType.ENTITY_NODE = 6;
    var PROCESSING_INSTRUCTION_NODE = NodeType.PROCESSING_INSTRUCTION_NODE = 7;
    var COMMENT_NODE = NodeType.COMMENT_NODE = 8;
    var DOCUMENT_NODE = NodeType.DOCUMENT_NODE = 9;
    var DOCUMENT_TYPE_NODE = NodeType.DOCUMENT_TYPE_NODE = 10;
    var DOCUMENT_FRAGMENT_NODE = NodeType.DOCUMENT_FRAGMENT_NODE = 11;
    var NOTATION_NODE = NodeType.NOTATION_NODE = 12;
    var ExceptionCode = {};
    var ExceptionMessage = {};
    var INDEX_SIZE_ERR = ExceptionCode.INDEX_SIZE_ERR = (ExceptionMessage[1] = "Index size error", 1);
    var DOMSTRING_SIZE_ERR = ExceptionCode.DOMSTRING_SIZE_ERR = (ExceptionMessage[2] = "DOMString size error", 2);
    var HIERARCHY_REQUEST_ERR = ExceptionCode.HIERARCHY_REQUEST_ERR = (ExceptionMessage[3] = "Hierarchy request error", 3);
    var WRONG_DOCUMENT_ERR = ExceptionCode.WRONG_DOCUMENT_ERR = (ExceptionMessage[4] = "Wrong document", 4);
    var INVALID_CHARACTER_ERR = ExceptionCode.INVALID_CHARACTER_ERR = (ExceptionMessage[5] = "Invalid character", 5);
    var NO_DATA_ALLOWED_ERR = ExceptionCode.NO_DATA_ALLOWED_ERR = (ExceptionMessage[6] = "No data allowed", 6);
    var NO_MODIFICATION_ALLOWED_ERR = ExceptionCode.NO_MODIFICATION_ALLOWED_ERR = (ExceptionMessage[7] = "No modification allowed", 7);
    var NOT_FOUND_ERR = ExceptionCode.NOT_FOUND_ERR = (ExceptionMessage[8] = "Not found", 8);
    var NOT_SUPPORTED_ERR = ExceptionCode.NOT_SUPPORTED_ERR = (ExceptionMessage[9] = "Not supported", 9);
    var INUSE_ATTRIBUTE_ERR = ExceptionCode.INUSE_ATTRIBUTE_ERR = (ExceptionMessage[10] = "Attribute in use", 10);
    var INVALID_STATE_ERR = ExceptionCode.INVALID_STATE_ERR = (ExceptionMessage[11] = "Invalid state", 11);
    var SYNTAX_ERR = ExceptionCode.SYNTAX_ERR = (ExceptionMessage[12] = "Syntax error", 12);
    var INVALID_MODIFICATION_ERR = ExceptionCode.INVALID_MODIFICATION_ERR = (ExceptionMessage[13] = "Invalid modification", 13);
    var NAMESPACE_ERR = ExceptionCode.NAMESPACE_ERR = (ExceptionMessage[14] = "Invalid namespace", 14);
    var INVALID_ACCESS_ERR = ExceptionCode.INVALID_ACCESS_ERR = (ExceptionMessage[15] = "Invalid access", 15);
    function DOMException(code, message) {
      if (message instanceof Error) {
        var error = message;
      } else {
        error = this;
        Error.call(this, ExceptionMessage[code]);
        this.message = ExceptionMessage[code];
        if (Error.captureStackTrace) Error.captureStackTrace(this, DOMException);
      }
      error.code = code;
      if (message) this.message = this.message + ": " + message;
      return error;
    }
    DOMException.prototype = Error.prototype;
    copy(ExceptionCode, DOMException);
    function NodeList() {
    }
    NodeList.prototype = {
      /**
       * The number of nodes in the list. The range of valid child node indices is 0 to length-1 inclusive.
       * @standard level1
       */
      length: 0,
      /**
       * Returns the indexth item in the collection. If index is greater than or equal to the number of nodes in the list, this returns null.
       * @standard level1
       * @param index  unsigned long
       *   Index into the collection.
       * @return Node
       * 	The node at the indexth position in the NodeList, or null if that is not a valid index.
       */
      item: function(index) {
        return index >= 0 && index < this.length ? this[index] : null;
      },
      toString: function(isHTML, nodeFilter, options) {
        var requireWellFormed = !!options && !!options.requireWellFormed;
        for (var buf = [], i = 0; i < this.length; i++) {
          serializeToString(this[i], buf, isHTML, nodeFilter, null, requireWellFormed);
        }
        return buf.join("");
      },
      /**
       * @private
       * @param {function (Node):boolean} predicate
       * @returns {Node[]}
       */
      filter: function(predicate) {
        return Array.prototype.filter.call(this, predicate);
      },
      /**
       * @private
       * @param {Node} item
       * @returns {number}
       */
      indexOf: function(item) {
        return Array.prototype.indexOf.call(this, item);
      }
    };
    function LiveNodeList(node, refresh) {
      this._node = node;
      this._refresh = refresh;
      _updateLiveList(this);
    }
    function _updateLiveList(list) {
      var inc = list._node._inc || list._node.ownerDocument._inc;
      if (list._inc !== inc) {
        var ls = list._refresh(list._node);
        __set__(list, "length", ls.length);
        if (!list.$$length || ls.length < list.$$length) {
          for (var i = ls.length; i in list; i++) {
            if (Object.prototype.hasOwnProperty.call(list, i)) {
              delete list[i];
            }
          }
        }
        copy(ls, list);
        list._inc = inc;
      }
    }
    LiveNodeList.prototype.item = function(i) {
      _updateLiveList(this);
      return this[i] || null;
    };
    _extends2(LiveNodeList, NodeList);
    function NamedNodeMap() {
      this._nameIndex = /* @__PURE__ */ Object.create(null);
    }
    function _findNodeIndex(list, node) {
      var i = list.length;
      while (i--) {
        if (list[i] === node) {
          return i;
        }
      }
    }
    function _nnmIndexAdd(list, attr) {
      list._nameIndex[attr.nodeName] = attr;
    }
    function _nnmIndexRemove(list, attr) {
      if (list._nameIndex[attr.nodeName] === attr) {
        delete list._nameIndex[attr.nodeName];
      }
    }
    function _addNamedNode(el, list, newAttr, oldAttr) {
      if (oldAttr) {
        list[_findNodeIndex(list, oldAttr)] = newAttr;
        _nnmIndexRemove(list, oldAttr);
      } else {
        list[list.length++] = newAttr;
      }
      _nnmIndexAdd(list, newAttr);
      if (el) {
        newAttr.ownerElement = el;
        var doc = el.ownerDocument;
        if (doc) {
          oldAttr && _onRemoveAttribute(doc, el, oldAttr);
          _onAddAttribute(doc, el, newAttr);
        }
      }
    }
    function _removeNamedNode(el, list, attr) {
      var i = _findNodeIndex(list, attr);
      if (i >= 0) {
        var lastIndex = list.length - 1;
        while (i < lastIndex) {
          list[i] = list[++i];
        }
        list.length = lastIndex;
        _nnmIndexRemove(list, attr);
        if (el) {
          var doc = el.ownerDocument;
          if (doc) {
            _onRemoveAttribute(doc, el, attr);
            attr.ownerElement = null;
          }
        }
      } else {
        throw new DOMException(NOT_FOUND_ERR, new Error(el.tagName + "@" + attr));
      }
    }
    NamedNodeMap.prototype = {
      length: 0,
      item: NodeList.prototype.item,
      getNamedItem: function(key) {
        var i = this.length;
        while (i--) {
          var attr = this[i];
          if (attr.nodeName == key) {
            return attr;
          }
        }
      },
      setNamedItem: function(attr) {
        var el = attr.ownerElement;
        if (el && el != this._ownerElement) {
          throw new DOMException(INUSE_ATTRIBUTE_ERR);
        }
        var oldAttr = this._nameIndex[attr.nodeName];
        _addNamedNode(this._ownerElement, this, attr, oldAttr);
        return oldAttr;
      },
      /* returns Node */
      setNamedItemNS: function(attr) {
        var el = attr.ownerElement, oldAttr;
        if (el && el != this._ownerElement) {
          throw new DOMException(INUSE_ATTRIBUTE_ERR);
        }
        oldAttr = this.getNamedItemNS(attr.namespaceURI, attr.localName);
        _addNamedNode(this._ownerElement, this, attr, oldAttr);
        return oldAttr;
      },
      /* returns Node */
      removeNamedItem: function(key) {
        var attr = this.getNamedItem(key);
        _removeNamedNode(this._ownerElement, this, attr);
        return attr;
      },
      // raises: NOT_FOUND_ERR,NO_MODIFICATION_ALLOWED_ERR
      //for level2
      removeNamedItemNS: function(namespaceURI, localName) {
        var attr = this.getNamedItemNS(namespaceURI, localName);
        _removeNamedNode(this._ownerElement, this, attr);
        return attr;
      },
      getNamedItemNS: function(namespaceURI, localName) {
        var i = this.length;
        while (i--) {
          var node = this[i];
          if (node.localName == localName && node.namespaceURI == namespaceURI) {
            return node;
          }
        }
        return null;
      }
    };
    function DOMImplementation() {
    }
    DOMImplementation.prototype = {
      /**
       * The DOMImplementation.hasFeature() method returns a Boolean flag indicating if a given feature is supported.
       * The different implementations fairly diverged in what kind of features were reported.
       * The latest version of the spec settled to force this method to always return true, where the functionality was accurate and in use.
       *
       * @deprecated It is deprecated and modern browsers return true in all cases.
       *
       * @param {string} feature
       * @param {string} [version]
       * @returns {boolean} always true
       *
       * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/hasFeature MDN
       * @see https://www.w3.org/TR/REC-DOM-Level-1/level-one-core.html#ID-5CED94D7 DOM Level 1 Core
       * @see https://dom.spec.whatwg.org/#dom-domimplementation-hasfeature DOM Living Standard
       */
      hasFeature: function(feature, version) {
        return true;
      },
      /**
       * Creates an XML Document object of the specified type with its document element.
       *
       * __It behaves slightly different from the description in the living standard__:
       * - There is no interface/class `XMLDocument`, it returns a `Document` instance.
       * - `contentType`, `encoding`, `mode`, `origin`, `url` fields are currently not declared.
       * - this implementation is not validating names or qualified names
       *   (when parsing XML strings, the SAX parser takes care of that)
       *
       * @param {string|null} namespaceURI
       * @param {string} qualifiedName
       * @param {DocumentType=null} doctype
       * @returns {Document}
       *
       * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/createDocument MDN
       * @see https://www.w3.org/TR/DOM-Level-2-Core/core.html#Level-2-Core-DOM-createDocument DOM Level 2 Core (initial)
       * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocument  DOM Level 2 Core
       *
       * @see https://dom.spec.whatwg.org/#validate-and-extract DOM: Validate and extract
       * @see https://www.w3.org/TR/xml/#NT-NameStartChar XML Spec: Names
       * @see https://www.w3.org/TR/xml-names/#ns-qualnames XML Namespaces: Qualified names
       */
      createDocument: function(namespaceURI, qualifiedName, doctype) {
        var doc = new Document();
        doc.implementation = this;
        doc.childNodes = new NodeList();
        doc.doctype = doctype || null;
        if (doctype) {
          doc.appendChild(doctype);
        }
        if (qualifiedName) {
          var root = doc.createElementNS(namespaceURI, qualifiedName);
          doc.appendChild(root);
        }
        return doc;
      },
      /**
       * Returns a doctype, with the given `qualifiedName`, `publicId`, and `systemId`.
       *
       * __This implementation differs from the specification:__
       * - this implementation is not validating names or qualified names
       *   (when parsing XML strings, the SAX parser takes care of that)
       *
       * Note: `internalSubset` can only be introduced via a direct property write to `node.internalSubset` after creation.
       * Creation-time validation of `publicId`, `systemId` is not enforced.
       * The serializer-level check covers all mutation vectors, including direct property writes.
       * `internalSubset` is only serialized as `[ ... ]` when both `publicId` and `systemId` are
       * absent (empty or `'.'`) — if either external identifier is present, `internalSubset` is
       * silently omitted from the serialized output.
       *
       * @param {string} qualifiedName
       * @param {string} [publicId]
       * The external subset public identifier. Stored verbatim including surrounding quotes.
       * When serialized with `requireWellFormed: true` (via the 4th-parameter options object),
       * throws `DOMException` with code `INVALID_STATE_ERR` if the value is non-empty and does
       * not match the XML `PubidLiteral` production (W3C DOM Parsing §3.2.1.3; XML 1.0 [12]).
       * @param {string} [systemId]
       * The external subset system identifier. Stored verbatim including surrounding quotes.
       * When serialized with `requireWellFormed: true`, throws `DOMException` with code
       * `INVALID_STATE_ERR` if the value is non-empty and does not match the XML `SystemLiteral`
       * production (W3C DOM Parsing §3.2.1.3; XML 1.0 [11]).
       * @returns {DocumentType} which can either be used with `DOMImplementation.createDocument` upon document creation
       * 				  or can be put into the document via methods like `Node.insertBefore()` or `Node.replaceChild()`
       *
       * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/createDocumentType MDN
       * @see https://www.w3.org/TR/DOM-Level-2-Core/core.html#Level-2-Core-DOM-createDocType DOM Level 2 Core
       * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocumenttype DOM Living Standard
       *
       * @see https://dom.spec.whatwg.org/#validate-and-extract DOM: Validate and extract
       * @see https://www.w3.org/TR/xml/#NT-NameStartChar XML Spec: Names
       * @see https://www.w3.org/TR/xml-names/#ns-qualnames XML Namespaces: Qualified names
       */
      createDocumentType: function(qualifiedName, publicId, systemId) {
        var node = new DocumentType();
        node.name = qualifiedName;
        node.nodeName = qualifiedName;
        node.publicId = publicId || "";
        node.systemId = systemId || "";
        return node;
      }
    };
    function Node() {
    }
    Node.prototype = {
      firstChild: null,
      lastChild: null,
      previousSibling: null,
      nextSibling: null,
      attributes: null,
      parentNode: null,
      childNodes: null,
      ownerDocument: null,
      nodeValue: null,
      namespaceURI: null,
      prefix: null,
      localName: null,
      // Modified in DOM Level 2:
      insertBefore: function(newChild, refChild) {
        return _insertBefore(this, newChild, refChild);
      },
      replaceChild: function(newChild, oldChild) {
        _insertBefore(this, newChild, oldChild, assertPreReplacementValidityInDocument);
        if (oldChild) {
          this.removeChild(oldChild);
        }
      },
      removeChild: function(oldChild) {
        return _removeChild(this, oldChild);
      },
      appendChild: function(newChild) {
        return this.insertBefore(newChild, null);
      },
      hasChildNodes: function() {
        return this.firstChild != null;
      },
      cloneNode: function(deep) {
        return cloneNode(this.ownerDocument || this, this, deep);
      },
      // Modified in DOM Level 2:
      /**
       * Puts the specified node and all of its subtree into a "normalized" form. In a normalized
       * subtree, no text nodes in the subtree are empty and there are no adjacent text nodes.
       *
       * Specifically, this method merges any adjacent text nodes (i.e., nodes for which `nodeType`
       * is `TEXT_NODE`) into a single node with the combined data. It also removes any empty text
       * nodes.
       *
       * This method iteratively traverses all child nodes to normalize all descendant nodes within
       * the subtree.
       *
       * @throws {DOMException}
       * May throw a DOMException if operations within removeChild or appendData (which are
       * potentially invoked in this method) do not meet their specific constraints.
       * @see {@link Node.removeChild}
       * @see {@link CharacterData.appendData}
       * @see ../docs/walk-dom.md.
       */
      normalize: function() {
        walkDOM(this, null, {
          enter: function(node) {
            var child = node.firstChild;
            while (child) {
              var next = child.nextSibling;
              if (next !== null && next.nodeType === TEXT_NODE && child.nodeType === TEXT_NODE) {
                var tail = [];
                var sibling = next;
                while (sibling !== null && sibling.nodeType === TEXT_NODE) {
                  tail.push(sibling.data);
                  sibling = sibling.nextSibling;
                }
                var removed = child.nextSibling;
                while (removed !== sibling) {
                  var following = removed.nextSibling;
                  removed.parentNode = null;
                  removed.previousSibling = null;
                  removed.nextSibling = null;
                  removed = following;
                }
                child.nextSibling = sibling;
                if (sibling !== null) {
                  sibling.previousSibling = child;
                } else {
                  node.lastChild = child;
                }
                child.appendData(tail.join(""));
                _onUpdateChild(node.ownerDocument, node);
                child = sibling;
              } else {
                child = next;
              }
            }
            return true;
          }
        });
      },
      // Introduced in DOM Level 2:
      isSupported: function(feature, version) {
        return this.ownerDocument.implementation.hasFeature(feature, version);
      },
      // Introduced in DOM Level 2:
      hasAttributes: function() {
        return this.attributes.length > 0;
      },
      /**
       * Look up the prefix associated to the given namespace URI, starting from this node.
       * **The default namespace declarations are ignored by this method.**
       * See Namespace Prefix Lookup for details on the algorithm used by this method.
       *
       * _Note: The implementation seems to be incomplete when compared to the algorithm described in the specs._
       *
       * @param {string | null} namespaceURI
       * @returns {string | null}
       * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Node3-lookupNamespacePrefix
       * @see https://www.w3.org/TR/DOM-Level-3-Core/namespaces-algorithms.html#lookupNamespacePrefixAlgo
       * @see https://dom.spec.whatwg.org/#dom-node-lookupprefix
       * @see https://github.com/xmldom/xmldom/issues/322
       */
      lookupPrefix: function(namespaceURI) {
        var el = this;
        while (el) {
          var map = el._nsMap;
          if (map) {
            for (var n in map) {
              if (Object.prototype.hasOwnProperty.call(map, n) && map[n] === namespaceURI) {
                return n;
              }
            }
          }
          el = el.nodeType == ATTRIBUTE_NODE ? el.ownerDocument : el.parentNode;
        }
        return null;
      },
      // Introduced in DOM Level 3:
      lookupNamespaceURI: function(prefix) {
        var el = this;
        while (el) {
          var map = el._nsMap;
          if (map) {
            if (Object.prototype.hasOwnProperty.call(map, prefix)) {
              return map[prefix];
            }
          }
          el = el.nodeType == ATTRIBUTE_NODE ? el.ownerDocument : el.parentNode;
        }
        return null;
      },
      // Introduced in DOM Level 3:
      isDefaultNamespace: function(namespaceURI) {
        var prefix = this.lookupPrefix(namespaceURI);
        return prefix == null;
      }
    };
    function _xmlEncoder(c) {
      return c == "<" && "&lt;" || c == ">" && "&gt;" || c == "&" && "&amp;" || c == '"' && "&quot;" || "&#" + c.charCodeAt() + ";";
    }
    copy(NodeType, Node);
    copy(NodeType, Node.prototype);
    function _visitNode(node, callback) {
      return walkDOM(node, null, { enter: function(n) {
        return callback(n) ? walkDOM.STOP : true;
      } }) === walkDOM.STOP;
    }
    function walkDOM(node, context, callbacks) {
      var stack = [{ node, context, phase: walkDOM.ENTER }];
      while (stack.length > 0) {
        var frame = stack.pop();
        if (frame.phase === walkDOM.ENTER) {
          var childContext = callbacks.enter(frame.node, frame.context);
          if (childContext === walkDOM.STOP) {
            return walkDOM.STOP;
          }
          stack.push({ node: frame.node, context: childContext, phase: walkDOM.EXIT });
          if (childContext === null || childContext === void 0) {
            continue;
          }
          var child = frame.node.lastChild;
          while (child) {
            stack.push({ node: child, context: childContext, phase: walkDOM.ENTER });
            child = child.previousSibling;
          }
        } else {
          if (callbacks.exit) {
            callbacks.exit(frame.node, frame.context);
          }
        }
      }
    }
    walkDOM.STOP = /* @__PURE__ */ Symbol("walkDOM.STOP");
    walkDOM.ENTER = 0;
    walkDOM.EXIT = 1;
    function Document() {
      this.ownerDocument = this;
    }
    function _onAddAttribute(doc, el, newAttr) {
      doc && doc._inc++;
      var ns = newAttr.namespaceURI;
      if (ns === NAMESPACE.XMLNS) {
        el._nsMap[newAttr.prefix ? newAttr.localName : ""] = newAttr.value;
      }
    }
    function _onRemoveAttribute(doc, el, newAttr, remove) {
      doc && doc._inc++;
      var ns = newAttr.namespaceURI;
      if (ns === NAMESPACE.XMLNS) {
        delete el._nsMap[newAttr.prefix ? newAttr.localName : ""];
      }
    }
    function _onUpdateChild(doc, el, newChild) {
      if (doc && doc._inc) {
        doc._inc++;
        var cs = el.childNodes;
        if (newChild) {
          cs[cs.length++] = newChild;
        } else {
          var child = el.firstChild;
          var i = 0;
          while (child) {
            cs[i++] = child;
            child = child.nextSibling;
          }
          cs.length = i;
          delete cs[cs.length];
        }
      }
    }
    function _removeChild(parentNode, child) {
      var previous = child.previousSibling;
      var next = child.nextSibling;
      if (previous) {
        previous.nextSibling = next;
      } else {
        parentNode.firstChild = next;
      }
      if (next) {
        next.previousSibling = previous;
      } else {
        parentNode.lastChild = previous;
      }
      child.parentNode = null;
      child.previousSibling = null;
      child.nextSibling = null;
      _onUpdateChild(parentNode.ownerDocument, parentNode);
      return child;
    }
    function hasValidParentNodeType(node) {
      return node && (node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE || node.nodeType === Node.ELEMENT_NODE);
    }
    function hasInsertableNodeType(node) {
      return node && (isElementNode(node) || isTextNode(node) || isDocTypeNode(node) || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE || node.nodeType === Node.COMMENT_NODE || node.nodeType === Node.PROCESSING_INSTRUCTION_NODE);
    }
    function isDocTypeNode(node) {
      return node && node.nodeType === Node.DOCUMENT_TYPE_NODE;
    }
    function isElementNode(node) {
      return node && node.nodeType === Node.ELEMENT_NODE;
    }
    function isTextNode(node) {
      return node && node.nodeType === Node.TEXT_NODE;
    }
    function isElementInsertionPossible(doc, child) {
      var parentChildNodes = doc.childNodes || [];
      if (find(parentChildNodes, isElementNode) || isDocTypeNode(child)) {
        return false;
      }
      var docTypeNode = find(parentChildNodes, isDocTypeNode);
      return !(child && docTypeNode && parentChildNodes.indexOf(docTypeNode) > parentChildNodes.indexOf(child));
    }
    function isElementReplacementPossible(doc, child) {
      var parentChildNodes = doc.childNodes || [];
      function hasElementChildThatIsNotChild(node) {
        return isElementNode(node) && node !== child;
      }
      if (find(parentChildNodes, hasElementChildThatIsNotChild)) {
        return false;
      }
      var docTypeNode = find(parentChildNodes, isDocTypeNode);
      return !(child && docTypeNode && parentChildNodes.indexOf(docTypeNode) > parentChildNodes.indexOf(child));
    }
    function assertPreInsertionValidity1to5(parent, node, child) {
      if (!hasValidParentNodeType(parent)) {
        throw new DOMException(HIERARCHY_REQUEST_ERR, "Unexpected parent node type " + parent.nodeType);
      }
      if (child && child.parentNode !== parent) {
        throw new DOMException(NOT_FOUND_ERR, "child not in parent");
      }
      if (
        // 4. If `node` is not a DocumentFragment, DocumentType, Element, or CharacterData node, then throw a "HierarchyRequestError" DOMException.
        !hasInsertableNodeType(node) || // 5. If either `node` is a Text node and `parent` is a document,
        // the sax parser currently adds top level text nodes, this will be fixed in 0.9.0
        // || (node.nodeType === Node.TEXT_NODE && parent.nodeType === Node.DOCUMENT_NODE)
        // or `node` is a doctype and `parent` is not a document, then throw a "HierarchyRequestError" DOMException.
        isDocTypeNode(node) && parent.nodeType !== Node.DOCUMENT_NODE
      ) {
        throw new DOMException(
          HIERARCHY_REQUEST_ERR,
          "Unexpected node type " + node.nodeType + " for parent node type " + parent.nodeType
        );
      }
    }
    function assertPreInsertionValidityInDocument(parent, node, child) {
      var parentChildNodes = parent.childNodes || [];
      var nodeChildNodes = node.childNodes || [];
      if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        var nodeChildElements = nodeChildNodes.filter(isElementNode);
        if (nodeChildElements.length > 1 || find(nodeChildNodes, isTextNode)) {
          throw new DOMException(HIERARCHY_REQUEST_ERR, "More than one element or text in fragment");
        }
        if (nodeChildElements.length === 1 && !isElementInsertionPossible(parent, child)) {
          throw new DOMException(HIERARCHY_REQUEST_ERR, "Element in fragment can not be inserted before doctype");
        }
      }
      if (isElementNode(node)) {
        if (!isElementInsertionPossible(parent, child)) {
          throw new DOMException(HIERARCHY_REQUEST_ERR, "Only one element can be added and only after doctype");
        }
      }
      if (isDocTypeNode(node)) {
        if (find(parentChildNodes, isDocTypeNode)) {
          throw new DOMException(HIERARCHY_REQUEST_ERR, "Only one doctype is allowed");
        }
        var parentElementChild = find(parentChildNodes, isElementNode);
        if (child && parentChildNodes.indexOf(parentElementChild) < parentChildNodes.indexOf(child)) {
          throw new DOMException(HIERARCHY_REQUEST_ERR, "Doctype can only be inserted before an element");
        }
        if (!child && parentElementChild) {
          throw new DOMException(HIERARCHY_REQUEST_ERR, "Doctype can not be appended since element is present");
        }
      }
    }
    function assertPreReplacementValidityInDocument(parent, node, child) {
      var parentChildNodes = parent.childNodes || [];
      var nodeChildNodes = node.childNodes || [];
      if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        var nodeChildElements = nodeChildNodes.filter(isElementNode);
        if (nodeChildElements.length > 1 || find(nodeChildNodes, isTextNode)) {
          throw new DOMException(HIERARCHY_REQUEST_ERR, "More than one element or text in fragment");
        }
        if (nodeChildElements.length === 1 && !isElementReplacementPossible(parent, child)) {
          throw new DOMException(HIERARCHY_REQUEST_ERR, "Element in fragment can not be inserted before doctype");
        }
      }
      if (isElementNode(node)) {
        if (!isElementReplacementPossible(parent, child)) {
          throw new DOMException(HIERARCHY_REQUEST_ERR, "Only one element can be added and only after doctype");
        }
      }
      if (isDocTypeNode(node)) {
        let hasDoctypeChildThatIsNotChild2 = function(node2) {
          return isDocTypeNode(node2) && node2 !== child;
        };
        var hasDoctypeChildThatIsNotChild = hasDoctypeChildThatIsNotChild2;
        if (find(parentChildNodes, hasDoctypeChildThatIsNotChild2)) {
          throw new DOMException(HIERARCHY_REQUEST_ERR, "Only one doctype is allowed");
        }
        var parentElementChild = find(parentChildNodes, isElementNode);
        if (child && parentChildNodes.indexOf(parentElementChild) < parentChildNodes.indexOf(child)) {
          throw new DOMException(HIERARCHY_REQUEST_ERR, "Doctype can only be inserted before an element");
        }
      }
    }
    function _insertBefore(parent, node, child, _inDocumentAssertion) {
      assertPreInsertionValidity1to5(parent, node, child);
      if (parent.nodeType === Node.DOCUMENT_NODE) {
        (_inDocumentAssertion || assertPreInsertionValidityInDocument)(parent, node, child);
      }
      var cp = node.parentNode;
      if (cp) {
        cp.removeChild(node);
      }
      if (node.nodeType === DOCUMENT_FRAGMENT_NODE) {
        var newFirst = node.firstChild;
        if (newFirst == null) {
          return node;
        }
        var newLast = node.lastChild;
      } else {
        newFirst = newLast = node;
      }
      var pre = child ? child.previousSibling : parent.lastChild;
      newFirst.previousSibling = pre;
      newLast.nextSibling = child;
      if (pre) {
        pre.nextSibling = newFirst;
      } else {
        parent.firstChild = newFirst;
      }
      if (child == null) {
        parent.lastChild = newLast;
      } else {
        child.previousSibling = newLast;
      }
      do {
        newFirst.parentNode = parent;
        var targetDoc = parent.ownerDocument || parent;
        _updateOwnerDocument(newFirst, targetDoc);
      } while (newFirst !== newLast && (newFirst = newFirst.nextSibling));
      _onUpdateChild(parent.ownerDocument || parent, parent);
      if (node.nodeType == DOCUMENT_FRAGMENT_NODE) {
        node.firstChild = node.lastChild = null;
      }
      return node;
    }
    function _updateOwnerDocument(node, newOwnerDocument) {
      if (node.ownerDocument === newOwnerDocument) {
        return;
      }
      node.ownerDocument = newOwnerDocument;
      if (node.nodeType === ELEMENT_NODE && node.attributes) {
        for (var i = 0; i < node.attributes.length; i++) {
          var attr = node.attributes.item(i);
          if (attr) {
            attr.ownerDocument = newOwnerDocument;
          }
        }
      }
      var child = node.firstChild;
      while (child) {
        _updateOwnerDocument(child, newOwnerDocument);
        child = child.nextSibling;
      }
    }
    function _appendSingleChild(parentNode, newChild) {
      if (newChild.parentNode) {
        newChild.parentNode.removeChild(newChild);
      }
      newChild.parentNode = parentNode;
      newChild.previousSibling = parentNode.lastChild;
      newChild.nextSibling = null;
      if (newChild.previousSibling) {
        newChild.previousSibling.nextSibling = newChild;
      } else {
        parentNode.firstChild = newChild;
      }
      parentNode.lastChild = newChild;
      _onUpdateChild(parentNode.ownerDocument, parentNode, newChild);
      var targetDoc = parentNode.ownerDocument || parentNode;
      _updateOwnerDocument(newChild, targetDoc);
      return newChild;
    }
    Document.prototype = {
      //implementation : null,
      nodeName: "#document",
      nodeType: DOCUMENT_NODE,
      /**
       * The DocumentType node of the document.
       *
       * @readonly
       * @type DocumentType
       */
      doctype: null,
      documentElement: null,
      _inc: 1,
      insertBefore: function(newChild, refChild) {
        if (newChild.nodeType == DOCUMENT_FRAGMENT_NODE) {
          var child = newChild.firstChild;
          while (child) {
            var next = child.nextSibling;
            this.insertBefore(child, refChild);
            child = next;
          }
          return newChild;
        }
        _insertBefore(this, newChild, refChild);
        _updateOwnerDocument(newChild, this);
        if (this.documentElement === null && newChild.nodeType === ELEMENT_NODE) {
          this.documentElement = newChild;
        }
        return newChild;
      },
      removeChild: function(oldChild) {
        if (this.documentElement == oldChild) {
          this.documentElement = null;
        }
        return _removeChild(this, oldChild);
      },
      replaceChild: function(newChild, oldChild) {
        _insertBefore(this, newChild, oldChild, assertPreReplacementValidityInDocument);
        _updateOwnerDocument(newChild, this);
        if (oldChild) {
          this.removeChild(oldChild);
        }
        if (isElementNode(newChild)) {
          this.documentElement = newChild;
        }
      },
      // Introduced in DOM Level 2:
      importNode: function(importedNode, deep) {
        return importNode(this, importedNode, deep);
      },
      // Introduced in DOM Level 2:
      getElementById: function(id) {
        var rtv = null;
        _visitNode(this.documentElement, function(node) {
          if (node.nodeType == ELEMENT_NODE) {
            if (node.getAttribute("id") == id) {
              rtv = node;
              return true;
            }
          }
        });
        return rtv;
      },
      /**
       * The `getElementsByClassName` method of `Document` interface returns an array-like object
       * of all child elements which have **all** of the given class name(s).
       *
       * Returns an empty list if `classeNames` is an empty string or only contains HTML white space characters.
       *
       *
       * Warning: This is a live LiveNodeList.
       * Changes in the DOM will reflect in the array as the changes occur.
       * If an element selected by this array no longer qualifies for the selector,
       * it will automatically be removed. Be aware of this for iteration purposes.
       *
       * @param {string} classNames is a string representing the class name(s) to match; multiple class names are separated by (ASCII-)whitespace
       *
       * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/getElementsByClassName
       * @see https://dom.spec.whatwg.org/#concept-getelementsbyclassname
       */
      getElementsByClassName: function(classNames) {
        var classNamesSet = toOrderedSet(classNames);
        return new LiveNodeList(this, function(base) {
          var ls = [];
          if (classNamesSet.length > 0) {
            _visitNode(base.documentElement, function(node) {
              if (node !== base && node.nodeType === ELEMENT_NODE) {
                var nodeClassNames = node.getAttribute("class");
                if (nodeClassNames) {
                  var matches = classNames === nodeClassNames;
                  if (!matches) {
                    var nodeClassNamesSet = toOrderedSet(nodeClassNames);
                    matches = classNamesSet.every(arrayIncludes(nodeClassNamesSet));
                  }
                  if (matches) {
                    ls.push(node);
                  }
                }
              }
            });
          }
          return ls;
        });
      },
      //document factory method:
      createElement: function(tagName) {
        var node = new Element();
        node.ownerDocument = this;
        node.nodeName = tagName;
        node.tagName = tagName;
        node.localName = tagName;
        node.childNodes = new NodeList();
        var attrs = node.attributes = new NamedNodeMap();
        attrs._ownerElement = node;
        return node;
      },
      createDocumentFragment: function() {
        var node = new DocumentFragment();
        node.ownerDocument = this;
        node.childNodes = new NodeList();
        return node;
      },
      createTextNode: function(data) {
        var node = new Text();
        node.ownerDocument = this;
        node.appendData(data);
        return node;
      },
      createComment: function(data) {
        var node = new Comment();
        node.ownerDocument = this;
        node.appendData(data);
        return node;
      },
      /**
       * Returns a new CDATASection node whose data is `data`.
       *
       * __This implementation differs from the specification:__
       * - calling this method on an HTML document does not throw `NotSupportedError`.
       *
       * @param {string} data
       * @returns {CDATASection}
       * @throws DOMException with code `INVALID_CHARACTER_ERR` if `data` contains `"]]>"`.
       * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/createCDATASection
       * @see https://dom.spec.whatwg.org/#dom-document-createcdatasection
       */
      createCDATASection: function(data) {
        if (data.indexOf("]]>") !== -1) {
          throw new DOMException(INVALID_CHARACTER_ERR, 'data contains "]]>"');
        }
        var node = new CDATASection();
        node.ownerDocument = this;
        node.appendData(data);
        return node;
      },
      /**
       * Returns a ProcessingInstruction node whose target is target and data is data.
       *
       * __This implementation differs from the specification:__
       * - it does not do any input validation on the arguments and doesn't throw "InvalidCharacterError".
       *
       * Note: When the resulting document is serialized with `requireWellFormed: true`, the
       * serializer throws with code `INVALID_STATE_ERR` if `.target` is not a valid XML `NCName`
       * (a `Name` with no colon) or is an ASCII case-insensitive match for `"xml"`, or if `.data`
       * contains `?>` (W3C DOM Parsing §3.2.1.7). Without that option the target and data are
       * emitted verbatim.
       *
       * @param {string} target
       * @param {string} data
       * @returns {ProcessingInstruction}
       * @see https://developer.mozilla.org/docs/Web/API/Document/createProcessingInstruction
       * @see https://dom.spec.whatwg.org/#dom-document-createprocessinginstruction
       * @see https://www.w3.org/TR/DOM-Parsing/#dfn-concept-serialize-xml §3.2.1.7
       */
      createProcessingInstruction: function(target, data) {
        var node = new ProcessingInstruction();
        node.ownerDocument = this;
        node.tagName = node.nodeName = node.target = target;
        node.nodeValue = node.data = data;
        return node;
      },
      createAttribute: function(name) {
        var node = new Attr();
        node.ownerDocument = this;
        node.name = name;
        node.nodeName = name;
        node.localName = name;
        node.specified = true;
        return node;
      },
      /**
       * Creates an EntityReference object, serialized as `&name;`.
       *
       * The `name` is validated against the XML `Name` production at creation time; an invalid name
       * throws a `DOMException` with code `INVALID_CHARACTER_ERR`. When the resulting node is
       * serialized with `requireWellFormed: true`, the serializer re-validates `nodeName` and throws
       * a `DOMException` with code `INVALID_STATE_ERR` if a later `nodeName` mutation made it invalid;
       * without that option the name is emitted verbatim.
       *
       * Note: xmldom does not expand entities — the parser resolves entity references inline and never
       * constructs `EntityReference` nodes, so this method is the only producer.
       *
       * @param {string} name The name of the entity to reference.
       * @returns {EntityReference}
       * @throws {DOMException} With code `INVALID_CHARACTER_ERR` when `name` is not a valid XML `Name`.
       * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#ID-392B75AE
       */
      createEntityReference: function(name) {
        if (!tagNamePattern.test(name)) {
          throw new DOMException(INVALID_CHARACTER_ERR, 'not a valid xml name "' + name + '"');
        }
        var node = new EntityReference();
        node.ownerDocument = this;
        node.nodeName = name;
        return node;
      },
      // Introduced in DOM Level 2:
      createElementNS: function(namespaceURI, qualifiedName) {
        var node = new Element();
        var pl = qualifiedName.split(":");
        var attrs = node.attributes = new NamedNodeMap();
        node.childNodes = new NodeList();
        node.ownerDocument = this;
        node.nodeName = qualifiedName;
        node.tagName = qualifiedName;
        node.namespaceURI = namespaceURI;
        if (pl.length == 2) {
          node.prefix = pl[0];
          node.localName = pl[1];
        } else {
          node.localName = qualifiedName;
        }
        attrs._ownerElement = node;
        return node;
      },
      // Introduced in DOM Level 2:
      createAttributeNS: function(namespaceURI, qualifiedName) {
        var node = new Attr();
        var pl = qualifiedName.split(":");
        node.ownerDocument = this;
        node.nodeName = qualifiedName;
        node.name = qualifiedName;
        node.namespaceURI = namespaceURI;
        node.specified = true;
        if (pl.length == 2) {
          node.prefix = pl[0];
          node.localName = pl[1];
        } else {
          node.localName = qualifiedName;
        }
        return node;
      }
    };
    _extends2(Document, Node);
    function Element() {
      this._nsMap = {};
    }
    Element.prototype = {
      nodeType: ELEMENT_NODE,
      hasAttribute: function(name) {
        return this.getAttributeNode(name) != null;
      },
      getAttribute: function(name) {
        var attr = this.getAttributeNode(name);
        return attr && attr.value || "";
      },
      getAttributeNode: function(name) {
        return this.attributes.getNamedItem(name);
      },
      setAttribute: function(name, value) {
        var attr = this.ownerDocument.createAttribute(name);
        attr.value = attr.nodeValue = "" + value;
        this.setAttributeNode(attr);
      },
      removeAttribute: function(name) {
        var attr = this.getAttributeNode(name);
        attr && this.removeAttributeNode(attr);
      },
      //four real opeartion method
      appendChild: function(newChild) {
        if (newChild.nodeType === DOCUMENT_FRAGMENT_NODE) {
          return this.insertBefore(newChild, null);
        } else {
          return _appendSingleChild(this, newChild);
        }
      },
      setAttributeNode: function(newAttr) {
        return this.attributes.setNamedItem(newAttr);
      },
      setAttributeNodeNS: function(newAttr) {
        return this.attributes.setNamedItemNS(newAttr);
      },
      removeAttributeNode: function(oldAttr) {
        return this.attributes.removeNamedItem(oldAttr.nodeName);
      },
      //get real attribute name,and remove it by removeAttributeNode
      removeAttributeNS: function(namespaceURI, localName) {
        var old = this.getAttributeNodeNS(namespaceURI, localName);
        old && this.removeAttributeNode(old);
      },
      hasAttributeNS: function(namespaceURI, localName) {
        return this.getAttributeNodeNS(namespaceURI, localName) != null;
      },
      getAttributeNS: function(namespaceURI, localName) {
        var attr = this.getAttributeNodeNS(namespaceURI, localName);
        return attr && attr.value || "";
      },
      setAttributeNS: function(namespaceURI, qualifiedName, value) {
        var attr = this.ownerDocument.createAttributeNS(namespaceURI, qualifiedName);
        attr.value = attr.nodeValue = "" + value;
        this.setAttributeNode(attr);
      },
      getAttributeNodeNS: function(namespaceURI, localName) {
        return this.attributes.getNamedItemNS(namespaceURI, localName);
      },
      getElementsByTagName: function(tagName) {
        return new LiveNodeList(this, function(base) {
          var ls = [];
          _visitNode(base, function(node) {
            if (node !== base && node.nodeType == ELEMENT_NODE && (tagName === "*" || node.tagName == tagName)) {
              ls.push(node);
            }
          });
          return ls;
        });
      },
      getElementsByTagNameNS: function(namespaceURI, localName) {
        return new LiveNodeList(this, function(base) {
          var ls = [];
          _visitNode(base, function(node) {
            if (node !== base && node.nodeType === ELEMENT_NODE && (namespaceURI === "*" || node.namespaceURI === namespaceURI) && (localName === "*" || node.localName == localName)) {
              ls.push(node);
            }
          });
          return ls;
        });
      }
    };
    Document.prototype.getElementsByTagName = Element.prototype.getElementsByTagName;
    Document.prototype.getElementsByTagNameNS = Element.prototype.getElementsByTagNameNS;
    _extends2(Element, Node);
    function Attr() {
    }
    Attr.prototype.nodeType = ATTRIBUTE_NODE;
    _extends2(Attr, Node);
    function CharacterData() {
    }
    CharacterData.prototype = {
      data: "",
      substringData: function(offset, count) {
        return this.data.substring(offset, offset + count);
      },
      appendData: function(text) {
        text = this.data + text;
        this.nodeValue = this.data = text;
        this.length = text.length;
      },
      insertData: function(offset, text) {
        this.replaceData(offset, 0, text);
      },
      appendChild: function(newChild) {
        throw new Error(ExceptionMessage[HIERARCHY_REQUEST_ERR]);
      },
      deleteData: function(offset, count) {
        this.replaceData(offset, count, "");
      },
      replaceData: function(offset, count, text) {
        var start = this.data.substring(0, offset);
        var end = this.data.substring(offset + count);
        text = start + text + end;
        this.nodeValue = this.data = text;
        this.length = text.length;
      }
    };
    _extends2(CharacterData, Node);
    function Text() {
    }
    Text.prototype = {
      nodeName: "#text",
      nodeType: TEXT_NODE,
      splitText: function(offset) {
        var text = this.data;
        var newText = text.substring(offset);
        text = text.substring(0, offset);
        this.data = this.nodeValue = text;
        this.length = text.length;
        var newNode = this.ownerDocument.createTextNode(newText);
        if (this.parentNode) {
          this.parentNode.insertBefore(newNode, this.nextSibling);
        }
        return newNode;
      }
    };
    _extends2(Text, CharacterData);
    function Comment() {
    }
    Comment.prototype = {
      nodeName: "#comment",
      nodeType: COMMENT_NODE
    };
    _extends2(Comment, CharacterData);
    function CDATASection() {
    }
    CDATASection.prototype = {
      nodeName: "#cdata-section",
      nodeType: CDATA_SECTION_NODE
    };
    _extends2(CDATASection, CharacterData);
    function DocumentType() {
    }
    DocumentType.prototype.nodeType = DOCUMENT_TYPE_NODE;
    _extends2(DocumentType, Node);
    function Notation() {
    }
    Notation.prototype.nodeType = NOTATION_NODE;
    _extends2(Notation, Node);
    function Entity() {
    }
    Entity.prototype.nodeType = ENTITY_NODE;
    _extends2(Entity, Node);
    function EntityReference() {
    }
    EntityReference.prototype.nodeType = ENTITY_REFERENCE_NODE;
    _extends2(EntityReference, Node);
    function DocumentFragment() {
    }
    DocumentFragment.prototype.nodeName = "#document-fragment";
    DocumentFragment.prototype.nodeType = DOCUMENT_FRAGMENT_NODE;
    _extends2(DocumentFragment, Node);
    function ProcessingInstruction() {
    }
    ProcessingInstruction.prototype.nodeType = PROCESSING_INSTRUCTION_NODE;
    _extends2(ProcessingInstruction, Node);
    function XMLSerializer() {
    }
    XMLSerializer.prototype.serializeToString = function(node, isHtml, nodeFilter, options) {
      return nodeSerializeToString.call(node, isHtml, nodeFilter, options);
    };
    Node.prototype.toString = nodeSerializeToString;
    function nodeSerializeToString(isHtml, nodeFilter, options) {
      var requireWellFormed = !!options && !!options.requireWellFormed;
      var buf = [];
      var refNode = this.nodeType == 9 && this.documentElement || this;
      var prefix = refNode.prefix;
      var uri = refNode.namespaceURI;
      if (uri && prefix == null) {
        var prefix = refNode.lookupPrefix(uri);
        if (prefix == null) {
          var visibleNamespaces = [
            { namespace: uri, prefix: null }
            //{namespace:uri,prefix:''}
          ];
        }
      }
      serializeToString(this, buf, isHtml, nodeFilter, visibleNamespaces, requireWellFormed);
      return buf.join("");
    }
    function needNamespaceDefine(node, isHTML, visibleNamespaces) {
      var prefix = node.prefix || "";
      var uri = node.namespaceURI;
      if (!uri) {
        return false;
      }
      if (prefix === "xml" && uri === NAMESPACE.XML || uri === NAMESPACE.XMLNS) {
        return false;
      }
      var i = visibleNamespaces.length;
      while (i--) {
        var ns = visibleNamespaces[i];
        if (ns.prefix === prefix) {
          return ns.namespace !== uri;
        }
      }
      return true;
    }
    function addSerializedAttribute(buf, qualifiedName, value, requireWellFormed) {
      if (requireWellFormed && !tagNamePattern.test(qualifiedName)) {
        throw new DOMException(INVALID_STATE_ERR, 'The attribute name "' + qualifiedName + '" is not a valid XML QName');
      }
      buf.push(" ", qualifiedName, '="', value.replace(/[<>&"\t\n\r]/g, _xmlEncoder), '"');
    }
    function serializeToString(node, buf, isHTML, nodeFilter, visibleNamespaces, requireWellFormed) {
      if (!visibleNamespaces) {
        visibleNamespaces = [];
      }
      walkDOM(node, { ns: visibleNamespaces, isHTML }, {
        enter: function(n, ctx) {
          var ns = ctx.ns;
          var html = ctx.isHTML;
          if (nodeFilter) {
            n = nodeFilter(n);
            if (n) {
              if (typeof n == "string") {
                buf.push(n);
                return null;
              }
            } else {
              return null;
            }
          }
          switch (n.nodeType) {
            case ELEMENT_NODE:
              var attrs = n.attributes;
              var len = attrs.length;
              var nodeName = n.tagName;
              html = NAMESPACE.isHTML(n.namespaceURI) || html;
              var prefixedNodeName = nodeName;
              if (!html && !n.prefix && n.namespaceURI) {
                var defaultNS;
                for (var ai = 0; ai < attrs.length; ai++) {
                  if (attrs.item(ai).name === "xmlns") {
                    defaultNS = attrs.item(ai).value;
                    break;
                  }
                }
                if (!defaultNS) {
                  for (var nsi = ns.length - 1; nsi >= 0; nsi--) {
                    var nsEntry = ns[nsi];
                    if (nsEntry.prefix === "" && nsEntry.namespace === n.namespaceURI) {
                      defaultNS = nsEntry.namespace;
                      break;
                    }
                  }
                }
                if (defaultNS !== n.namespaceURI) {
                  for (var nsi = ns.length - 1; nsi >= 0; nsi--) {
                    var nsEntry = ns[nsi];
                    if (nsEntry.namespace === n.namespaceURI) {
                      if (nsEntry.prefix) {
                        prefixedNodeName = nsEntry.prefix + ":" + nodeName;
                      }
                      break;
                    }
                  }
                }
              }
              if (requireWellFormed && !tagNamePattern.test(prefixedNodeName)) {
                throw new DOMException(INVALID_STATE_ERR, 'The element name "' + prefixedNodeName + '" is not a valid XML QName');
              }
              buf.push("<", prefixedNodeName);
              var childNs = ns.slice();
              for (var i = 0; i < len; i++) {
                var attr = attrs.item(i);
                if (attr.prefix == "xmlns") {
                  childNs.push({ prefix: attr.localName, namespace: attr.value });
                } else if (attr.nodeName == "xmlns") {
                  childNs.push({ prefix: "", namespace: attr.value });
                }
              }
              for (var i = 0; i < len; i++) {
                var attr = attrs.item(i);
                if (needNamespaceDefine(attr, html, childNs)) {
                  var attrPrefix = attr.prefix || "";
                  var uri = attr.namespaceURI;
                  addSerializedAttribute(buf, attrPrefix ? "xmlns:" + attrPrefix : "xmlns", uri, requireWellFormed);
                  childNs.push({ prefix: attrPrefix, namespace: uri });
                }
                var filteredAttr = nodeFilter ? nodeFilter(attr) : attr;
                if (filteredAttr) {
                  if (typeof filteredAttr === "string") {
                    buf.push(filteredAttr);
                  } else {
                    addSerializedAttribute(buf, filteredAttr.name, filteredAttr.value, requireWellFormed);
                  }
                }
              }
              if (nodeName === prefixedNodeName && needNamespaceDefine(n, html, childNs)) {
                var nodePrefix = n.prefix || "";
                var uri = n.namespaceURI;
                addSerializedAttribute(buf, nodePrefix ? "xmlns:" + nodePrefix : "xmlns", uri, requireWellFormed);
                childNs.push({ prefix: nodePrefix, namespace: uri });
              }
              var child = n.firstChild;
              if (child || html && !/^(?:meta|link|img|br|hr|input)$/i.test(nodeName)) {
                buf.push(">");
                if (html && /^script$/i.test(nodeName)) {
                  while (child) {
                    if (child.data) {
                      buf.push(child.data);
                    } else {
                      serializeToString(child, buf, html, nodeFilter, childNs.slice(), requireWellFormed);
                    }
                    child = child.nextSibling;
                  }
                  buf.push("</", nodeName, ">");
                  return null;
                }
                return { ns: childNs, isHTML: html, tag: prefixedNodeName };
              } else {
                buf.push("/>");
                return null;
              }
            case DOCUMENT_NODE:
            case DOCUMENT_FRAGMENT_NODE:
              return { ns: ns.slice(), isHTML: html, tag: null };
            case ATTRIBUTE_NODE:
              addSerializedAttribute(buf, n.name, n.value, requireWellFormed);
              return null;
            case TEXT_NODE:
              buf.push(n.data.replace(/[<&>]/g, _xmlEncoder));
              return null;
            case CDATA_SECTION_NODE:
              if (requireWellFormed && n.data.indexOf("]]>") !== -1) {
                throw new DOMException(INVALID_STATE_ERR, 'The CDATASection data contains "]]>"');
              }
              buf.push("<![CDATA[", n.data.replace(/]]>/g, "]]]]><![CDATA[>"), "]]>");
              return null;
            case COMMENT_NODE:
              if (requireWellFormed && n.data.indexOf("-->") !== -1) {
                throw new DOMException(INVALID_STATE_ERR, 'The comment node data contains "-->"');
              }
              buf.push("<!--", n.data, "-->");
              return null;
            case DOCUMENT_TYPE_NODE:
              if (requireWellFormed) {
                if (!tagNamePattern.test(n.name)) {
                  throw new DOMException(INVALID_STATE_ERR, 'The doctype name "' + n.name + '" is not a valid XML Name');
                }
                if (n.publicId && !/^("[\x20\r\na-zA-Z0-9\-()+,.\/:=?;!*#@$_%']*"|'[\x20\r\na-zA-Z0-9\-()+,.\/:=?;!*#@$_%'"]*')$/.test(n.publicId)) {
                  throw new DOMException(INVALID_STATE_ERR, "DocumentType publicId is not a valid PubidLiteral");
                }
                if (n.systemId && !/^("[^"]*"|'[^']*')$/.test(n.systemId)) {
                  throw new DOMException(INVALID_STATE_ERR, "DocumentType systemId is not a valid SystemLiteral");
                }
                if (n.internalSubset && n.internalSubset.indexOf("]>") !== -1) {
                  throw new DOMException(INVALID_STATE_ERR, 'DocumentType internalSubset contains "]>"');
                }
              }
              var pubid = n.publicId;
              var sysid = n.systemId;
              buf.push("<!DOCTYPE ", n.name);
              if (pubid) {
                buf.push(" PUBLIC ", pubid);
                if (sysid && sysid != ".") {
                  buf.push(" ", sysid);
                }
                buf.push(">");
              } else if (sysid && sysid != ".") {
                buf.push(" SYSTEM ", sysid, ">");
              } else {
                var sub = n.internalSubset;
                if (sub) {
                  buf.push(" [", sub, "]");
                }
                buf.push(">");
              }
              return null;
            case PROCESSING_INSTRUCTION_NODE:
              if (requireWellFormed) {
                if (!tagNamePattern.test(n.target) || n.target.indexOf(":") !== -1 || n.target.toLowerCase() === "xml") {
                  throw new DOMException(
                    INVALID_STATE_ERR,
                    'The processing instruction target "' + n.target + '" is not a valid XML NCName or is reserved'
                  );
                }
                if (n.data.indexOf("?>") !== -1) {
                  throw new DOMException(INVALID_STATE_ERR, 'The ProcessingInstruction data contains "?>"');
                }
              }
              buf.push("<?", n.target, " ", n.data, "?>");
              return null;
            case ENTITY_REFERENCE_NODE:
              if (requireWellFormed && !tagNamePattern.test(n.nodeName)) {
                throw new DOMException(
                  INVALID_STATE_ERR,
                  'The entity reference name "' + n.nodeName + '" is not a valid XML Name'
                );
              }
              buf.push("&", n.nodeName, ";");
              return null;
            //case ENTITY_NODE:
            //case NOTATION_NODE:
            default:
              buf.push("??", n.nodeName);
              return null;
          }
        },
        exit: function(n, childCtx) {
          if (childCtx && childCtx.tag) {
            buf.push("</", childCtx.tag, ">");
          }
        }
      });
    }
    function importNode(doc, node, deep) {
      var destRoot;
      walkDOM(node, null, {
        enter: function(srcNode, destParent) {
          var destNode = srcNode.cloneNode(false);
          destNode.ownerDocument = doc;
          destNode.parentNode = null;
          if (destParent === null) {
            destRoot = destNode;
          } else {
            destParent.appendChild(destNode);
          }
          var shouldDeep = srcNode.nodeType === ATTRIBUTE_NODE || deep;
          return shouldDeep ? destNode : null;
        }
      });
      return destRoot;
    }
    function cloneNode(doc, node, deep) {
      var destRoot;
      walkDOM(node, null, {
        enter: function(srcNode, destParent) {
          var destNode = new srcNode.constructor();
          for (var n in srcNode) {
            if (Object.prototype.hasOwnProperty.call(srcNode, n)) {
              var v = srcNode[n];
              if (typeof v != "object") {
                if (v != destNode[n]) {
                  destNode[n] = v;
                }
              }
            }
          }
          if (srcNode.childNodes) {
            destNode.childNodes = new NodeList();
          }
          destNode.ownerDocument = doc;
          var shouldDeep = deep;
          switch (destNode.nodeType) {
            case ELEMENT_NODE:
              var attrs = srcNode.attributes;
              var attrs2 = destNode.attributes = new NamedNodeMap();
              var len = attrs.length;
              attrs2._ownerElement = destNode;
              for (var i = 0; i < len; i++) {
                destNode.setAttributeNode(cloneNode(doc, attrs.item(i), true));
              }
              break;
            case ATTRIBUTE_NODE:
              shouldDeep = true;
          }
          if (destParent !== null) {
            destParent.appendChild(destNode);
          } else {
            destRoot = destNode;
          }
          return shouldDeep ? destNode : null;
        }
      });
      return destRoot;
    }
    function __set__(object, key, value) {
      object[key] = value;
    }
    try {
      if (Object.defineProperty) {
        Object.defineProperty(LiveNodeList.prototype, "length", {
          get: function() {
            _updateLiveList(this);
            return this.$$length;
          }
        });
        Object.defineProperty(Node.prototype, "textContent", {
          get: function() {
            if (this.nodeType === ELEMENT_NODE || this.nodeType === DOCUMENT_FRAGMENT_NODE) {
              var buf = [];
              walkDOM(this, null, {
                enter: function(n) {
                  if (n.nodeType === ELEMENT_NODE || n.nodeType === DOCUMENT_FRAGMENT_NODE) {
                    return true;
                  }
                  if (n.nodeType === PROCESSING_INSTRUCTION_NODE || n.nodeType === COMMENT_NODE) {
                    return null;
                  }
                  buf.push(n.nodeValue);
                }
              });
              return buf.join("");
            }
            return this.nodeValue;
          },
          set: function(data) {
            switch (this.nodeType) {
              case ELEMENT_NODE:
              case DOCUMENT_FRAGMENT_NODE:
                while (this.firstChild) {
                  this.removeChild(this.firstChild);
                }
                if (data || String(data)) {
                  this.appendChild(this.ownerDocument.createTextNode(data));
                }
                break;
              default:
                this.data = data;
                this.value = data;
                this.nodeValue = data;
            }
          }
        });
        __set__ = function(object, key, value) {
          object["$$" + key] = value;
        };
      }
    } catch (e) {
    }
    exports.DocumentType = DocumentType;
    exports.DOMException = DOMException;
    exports.DOMImplementation = DOMImplementation;
    exports.Element = Element;
    exports.Node = Node;
    exports.NodeList = NodeList;
    exports.walkDOM = walkDOM;
    exports.XMLSerializer = XMLSerializer;
  }
});

// work/browser-build/node_modules/@xmldom/xmldom/lib/entities.js
var require_entities = __commonJS({
  "work/browser-build/node_modules/@xmldom/xmldom/lib/entities.js"(exports) {
    "use strict";
    var freeze = require_conventions().freeze;
    exports.XML_ENTITIES = freeze({
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      quot: '"'
    });
    exports.HTML_ENTITIES = freeze({
      Aacute: "\xC1",
      aacute: "\xE1",
      Abreve: "\u0102",
      abreve: "\u0103",
      ac: "\u223E",
      acd: "\u223F",
      acE: "\u223E\u0333",
      Acirc: "\xC2",
      acirc: "\xE2",
      acute: "\xB4",
      Acy: "\u0410",
      acy: "\u0430",
      AElig: "\xC6",
      aelig: "\xE6",
      af: "\u2061",
      Afr: "\u{1D504}",
      afr: "\u{1D51E}",
      Agrave: "\xC0",
      agrave: "\xE0",
      alefsym: "\u2135",
      aleph: "\u2135",
      Alpha: "\u0391",
      alpha: "\u03B1",
      Amacr: "\u0100",
      amacr: "\u0101",
      amalg: "\u2A3F",
      AMP: "&",
      amp: "&",
      And: "\u2A53",
      and: "\u2227",
      andand: "\u2A55",
      andd: "\u2A5C",
      andslope: "\u2A58",
      andv: "\u2A5A",
      ang: "\u2220",
      ange: "\u29A4",
      angle: "\u2220",
      angmsd: "\u2221",
      angmsdaa: "\u29A8",
      angmsdab: "\u29A9",
      angmsdac: "\u29AA",
      angmsdad: "\u29AB",
      angmsdae: "\u29AC",
      angmsdaf: "\u29AD",
      angmsdag: "\u29AE",
      angmsdah: "\u29AF",
      angrt: "\u221F",
      angrtvb: "\u22BE",
      angrtvbd: "\u299D",
      angsph: "\u2222",
      angst: "\xC5",
      angzarr: "\u237C",
      Aogon: "\u0104",
      aogon: "\u0105",
      Aopf: "\u{1D538}",
      aopf: "\u{1D552}",
      ap: "\u2248",
      apacir: "\u2A6F",
      apE: "\u2A70",
      ape: "\u224A",
      apid: "\u224B",
      apos: "'",
      ApplyFunction: "\u2061",
      approx: "\u2248",
      approxeq: "\u224A",
      Aring: "\xC5",
      aring: "\xE5",
      Ascr: "\u{1D49C}",
      ascr: "\u{1D4B6}",
      Assign: "\u2254",
      ast: "*",
      asymp: "\u2248",
      asympeq: "\u224D",
      Atilde: "\xC3",
      atilde: "\xE3",
      Auml: "\xC4",
      auml: "\xE4",
      awconint: "\u2233",
      awint: "\u2A11",
      backcong: "\u224C",
      backepsilon: "\u03F6",
      backprime: "\u2035",
      backsim: "\u223D",
      backsimeq: "\u22CD",
      Backslash: "\u2216",
      Barv: "\u2AE7",
      barvee: "\u22BD",
      Barwed: "\u2306",
      barwed: "\u2305",
      barwedge: "\u2305",
      bbrk: "\u23B5",
      bbrktbrk: "\u23B6",
      bcong: "\u224C",
      Bcy: "\u0411",
      bcy: "\u0431",
      bdquo: "\u201E",
      becaus: "\u2235",
      Because: "\u2235",
      because: "\u2235",
      bemptyv: "\u29B0",
      bepsi: "\u03F6",
      bernou: "\u212C",
      Bernoullis: "\u212C",
      Beta: "\u0392",
      beta: "\u03B2",
      beth: "\u2136",
      between: "\u226C",
      Bfr: "\u{1D505}",
      bfr: "\u{1D51F}",
      bigcap: "\u22C2",
      bigcirc: "\u25EF",
      bigcup: "\u22C3",
      bigodot: "\u2A00",
      bigoplus: "\u2A01",
      bigotimes: "\u2A02",
      bigsqcup: "\u2A06",
      bigstar: "\u2605",
      bigtriangledown: "\u25BD",
      bigtriangleup: "\u25B3",
      biguplus: "\u2A04",
      bigvee: "\u22C1",
      bigwedge: "\u22C0",
      bkarow: "\u290D",
      blacklozenge: "\u29EB",
      blacksquare: "\u25AA",
      blacktriangle: "\u25B4",
      blacktriangledown: "\u25BE",
      blacktriangleleft: "\u25C2",
      blacktriangleright: "\u25B8",
      blank: "\u2423",
      blk12: "\u2592",
      blk14: "\u2591",
      blk34: "\u2593",
      block: "\u2588",
      bne: "=\u20E5",
      bnequiv: "\u2261\u20E5",
      bNot: "\u2AED",
      bnot: "\u2310",
      Bopf: "\u{1D539}",
      bopf: "\u{1D553}",
      bot: "\u22A5",
      bottom: "\u22A5",
      bowtie: "\u22C8",
      boxbox: "\u29C9",
      boxDL: "\u2557",
      boxDl: "\u2556",
      boxdL: "\u2555",
      boxdl: "\u2510",
      boxDR: "\u2554",
      boxDr: "\u2553",
      boxdR: "\u2552",
      boxdr: "\u250C",
      boxH: "\u2550",
      boxh: "\u2500",
      boxHD: "\u2566",
      boxHd: "\u2564",
      boxhD: "\u2565",
      boxhd: "\u252C",
      boxHU: "\u2569",
      boxHu: "\u2567",
      boxhU: "\u2568",
      boxhu: "\u2534",
      boxminus: "\u229F",
      boxplus: "\u229E",
      boxtimes: "\u22A0",
      boxUL: "\u255D",
      boxUl: "\u255C",
      boxuL: "\u255B",
      boxul: "\u2518",
      boxUR: "\u255A",
      boxUr: "\u2559",
      boxuR: "\u2558",
      boxur: "\u2514",
      boxV: "\u2551",
      boxv: "\u2502",
      boxVH: "\u256C",
      boxVh: "\u256B",
      boxvH: "\u256A",
      boxvh: "\u253C",
      boxVL: "\u2563",
      boxVl: "\u2562",
      boxvL: "\u2561",
      boxvl: "\u2524",
      boxVR: "\u2560",
      boxVr: "\u255F",
      boxvR: "\u255E",
      boxvr: "\u251C",
      bprime: "\u2035",
      Breve: "\u02D8",
      breve: "\u02D8",
      brvbar: "\xA6",
      Bscr: "\u212C",
      bscr: "\u{1D4B7}",
      bsemi: "\u204F",
      bsim: "\u223D",
      bsime: "\u22CD",
      bsol: "\\",
      bsolb: "\u29C5",
      bsolhsub: "\u27C8",
      bull: "\u2022",
      bullet: "\u2022",
      bump: "\u224E",
      bumpE: "\u2AAE",
      bumpe: "\u224F",
      Bumpeq: "\u224E",
      bumpeq: "\u224F",
      Cacute: "\u0106",
      cacute: "\u0107",
      Cap: "\u22D2",
      cap: "\u2229",
      capand: "\u2A44",
      capbrcup: "\u2A49",
      capcap: "\u2A4B",
      capcup: "\u2A47",
      capdot: "\u2A40",
      CapitalDifferentialD: "\u2145",
      caps: "\u2229\uFE00",
      caret: "\u2041",
      caron: "\u02C7",
      Cayleys: "\u212D",
      ccaps: "\u2A4D",
      Ccaron: "\u010C",
      ccaron: "\u010D",
      Ccedil: "\xC7",
      ccedil: "\xE7",
      Ccirc: "\u0108",
      ccirc: "\u0109",
      Cconint: "\u2230",
      ccups: "\u2A4C",
      ccupssm: "\u2A50",
      Cdot: "\u010A",
      cdot: "\u010B",
      cedil: "\xB8",
      Cedilla: "\xB8",
      cemptyv: "\u29B2",
      cent: "\xA2",
      CenterDot: "\xB7",
      centerdot: "\xB7",
      Cfr: "\u212D",
      cfr: "\u{1D520}",
      CHcy: "\u0427",
      chcy: "\u0447",
      check: "\u2713",
      checkmark: "\u2713",
      Chi: "\u03A7",
      chi: "\u03C7",
      cir: "\u25CB",
      circ: "\u02C6",
      circeq: "\u2257",
      circlearrowleft: "\u21BA",
      circlearrowright: "\u21BB",
      circledast: "\u229B",
      circledcirc: "\u229A",
      circleddash: "\u229D",
      CircleDot: "\u2299",
      circledR: "\xAE",
      circledS: "\u24C8",
      CircleMinus: "\u2296",
      CirclePlus: "\u2295",
      CircleTimes: "\u2297",
      cirE: "\u29C3",
      cire: "\u2257",
      cirfnint: "\u2A10",
      cirmid: "\u2AEF",
      cirscir: "\u29C2",
      ClockwiseContourIntegral: "\u2232",
      CloseCurlyDoubleQuote: "\u201D",
      CloseCurlyQuote: "\u2019",
      clubs: "\u2663",
      clubsuit: "\u2663",
      Colon: "\u2237",
      colon: ":",
      Colone: "\u2A74",
      colone: "\u2254",
      coloneq: "\u2254",
      comma: ",",
      commat: "@",
      comp: "\u2201",
      compfn: "\u2218",
      complement: "\u2201",
      complexes: "\u2102",
      cong: "\u2245",
      congdot: "\u2A6D",
      Congruent: "\u2261",
      Conint: "\u222F",
      conint: "\u222E",
      ContourIntegral: "\u222E",
      Copf: "\u2102",
      copf: "\u{1D554}",
      coprod: "\u2210",
      Coproduct: "\u2210",
      COPY: "\xA9",
      copy: "\xA9",
      copysr: "\u2117",
      CounterClockwiseContourIntegral: "\u2233",
      crarr: "\u21B5",
      Cross: "\u2A2F",
      cross: "\u2717",
      Cscr: "\u{1D49E}",
      cscr: "\u{1D4B8}",
      csub: "\u2ACF",
      csube: "\u2AD1",
      csup: "\u2AD0",
      csupe: "\u2AD2",
      ctdot: "\u22EF",
      cudarrl: "\u2938",
      cudarrr: "\u2935",
      cuepr: "\u22DE",
      cuesc: "\u22DF",
      cularr: "\u21B6",
      cularrp: "\u293D",
      Cup: "\u22D3",
      cup: "\u222A",
      cupbrcap: "\u2A48",
      CupCap: "\u224D",
      cupcap: "\u2A46",
      cupcup: "\u2A4A",
      cupdot: "\u228D",
      cupor: "\u2A45",
      cups: "\u222A\uFE00",
      curarr: "\u21B7",
      curarrm: "\u293C",
      curlyeqprec: "\u22DE",
      curlyeqsucc: "\u22DF",
      curlyvee: "\u22CE",
      curlywedge: "\u22CF",
      curren: "\xA4",
      curvearrowleft: "\u21B6",
      curvearrowright: "\u21B7",
      cuvee: "\u22CE",
      cuwed: "\u22CF",
      cwconint: "\u2232",
      cwint: "\u2231",
      cylcty: "\u232D",
      Dagger: "\u2021",
      dagger: "\u2020",
      daleth: "\u2138",
      Darr: "\u21A1",
      dArr: "\u21D3",
      darr: "\u2193",
      dash: "\u2010",
      Dashv: "\u2AE4",
      dashv: "\u22A3",
      dbkarow: "\u290F",
      dblac: "\u02DD",
      Dcaron: "\u010E",
      dcaron: "\u010F",
      Dcy: "\u0414",
      dcy: "\u0434",
      DD: "\u2145",
      dd: "\u2146",
      ddagger: "\u2021",
      ddarr: "\u21CA",
      DDotrahd: "\u2911",
      ddotseq: "\u2A77",
      deg: "\xB0",
      Del: "\u2207",
      Delta: "\u0394",
      delta: "\u03B4",
      demptyv: "\u29B1",
      dfisht: "\u297F",
      Dfr: "\u{1D507}",
      dfr: "\u{1D521}",
      dHar: "\u2965",
      dharl: "\u21C3",
      dharr: "\u21C2",
      DiacriticalAcute: "\xB4",
      DiacriticalDot: "\u02D9",
      DiacriticalDoubleAcute: "\u02DD",
      DiacriticalGrave: "`",
      DiacriticalTilde: "\u02DC",
      diam: "\u22C4",
      Diamond: "\u22C4",
      diamond: "\u22C4",
      diamondsuit: "\u2666",
      diams: "\u2666",
      die: "\xA8",
      DifferentialD: "\u2146",
      digamma: "\u03DD",
      disin: "\u22F2",
      div: "\xF7",
      divide: "\xF7",
      divideontimes: "\u22C7",
      divonx: "\u22C7",
      DJcy: "\u0402",
      djcy: "\u0452",
      dlcorn: "\u231E",
      dlcrop: "\u230D",
      dollar: "$",
      Dopf: "\u{1D53B}",
      dopf: "\u{1D555}",
      Dot: "\xA8",
      dot: "\u02D9",
      DotDot: "\u20DC",
      doteq: "\u2250",
      doteqdot: "\u2251",
      DotEqual: "\u2250",
      dotminus: "\u2238",
      dotplus: "\u2214",
      dotsquare: "\u22A1",
      doublebarwedge: "\u2306",
      DoubleContourIntegral: "\u222F",
      DoubleDot: "\xA8",
      DoubleDownArrow: "\u21D3",
      DoubleLeftArrow: "\u21D0",
      DoubleLeftRightArrow: "\u21D4",
      DoubleLeftTee: "\u2AE4",
      DoubleLongLeftArrow: "\u27F8",
      DoubleLongLeftRightArrow: "\u27FA",
      DoubleLongRightArrow: "\u27F9",
      DoubleRightArrow: "\u21D2",
      DoubleRightTee: "\u22A8",
      DoubleUpArrow: "\u21D1",
      DoubleUpDownArrow: "\u21D5",
      DoubleVerticalBar: "\u2225",
      DownArrow: "\u2193",
      Downarrow: "\u21D3",
      downarrow: "\u2193",
      DownArrowBar: "\u2913",
      DownArrowUpArrow: "\u21F5",
      DownBreve: "\u0311",
      downdownarrows: "\u21CA",
      downharpoonleft: "\u21C3",
      downharpoonright: "\u21C2",
      DownLeftRightVector: "\u2950",
      DownLeftTeeVector: "\u295E",
      DownLeftVector: "\u21BD",
      DownLeftVectorBar: "\u2956",
      DownRightTeeVector: "\u295F",
      DownRightVector: "\u21C1",
      DownRightVectorBar: "\u2957",
      DownTee: "\u22A4",
      DownTeeArrow: "\u21A7",
      drbkarow: "\u2910",
      drcorn: "\u231F",
      drcrop: "\u230C",
      Dscr: "\u{1D49F}",
      dscr: "\u{1D4B9}",
      DScy: "\u0405",
      dscy: "\u0455",
      dsol: "\u29F6",
      Dstrok: "\u0110",
      dstrok: "\u0111",
      dtdot: "\u22F1",
      dtri: "\u25BF",
      dtrif: "\u25BE",
      duarr: "\u21F5",
      duhar: "\u296F",
      dwangle: "\u29A6",
      DZcy: "\u040F",
      dzcy: "\u045F",
      dzigrarr: "\u27FF",
      Eacute: "\xC9",
      eacute: "\xE9",
      easter: "\u2A6E",
      Ecaron: "\u011A",
      ecaron: "\u011B",
      ecir: "\u2256",
      Ecirc: "\xCA",
      ecirc: "\xEA",
      ecolon: "\u2255",
      Ecy: "\u042D",
      ecy: "\u044D",
      eDDot: "\u2A77",
      Edot: "\u0116",
      eDot: "\u2251",
      edot: "\u0117",
      ee: "\u2147",
      efDot: "\u2252",
      Efr: "\u{1D508}",
      efr: "\u{1D522}",
      eg: "\u2A9A",
      Egrave: "\xC8",
      egrave: "\xE8",
      egs: "\u2A96",
      egsdot: "\u2A98",
      el: "\u2A99",
      Element: "\u2208",
      elinters: "\u23E7",
      ell: "\u2113",
      els: "\u2A95",
      elsdot: "\u2A97",
      Emacr: "\u0112",
      emacr: "\u0113",
      empty: "\u2205",
      emptyset: "\u2205",
      EmptySmallSquare: "\u25FB",
      emptyv: "\u2205",
      EmptyVerySmallSquare: "\u25AB",
      emsp: "\u2003",
      emsp13: "\u2004",
      emsp14: "\u2005",
      ENG: "\u014A",
      eng: "\u014B",
      ensp: "\u2002",
      Eogon: "\u0118",
      eogon: "\u0119",
      Eopf: "\u{1D53C}",
      eopf: "\u{1D556}",
      epar: "\u22D5",
      eparsl: "\u29E3",
      eplus: "\u2A71",
      epsi: "\u03B5",
      Epsilon: "\u0395",
      epsilon: "\u03B5",
      epsiv: "\u03F5",
      eqcirc: "\u2256",
      eqcolon: "\u2255",
      eqsim: "\u2242",
      eqslantgtr: "\u2A96",
      eqslantless: "\u2A95",
      Equal: "\u2A75",
      equals: "=",
      EqualTilde: "\u2242",
      equest: "\u225F",
      Equilibrium: "\u21CC",
      equiv: "\u2261",
      equivDD: "\u2A78",
      eqvparsl: "\u29E5",
      erarr: "\u2971",
      erDot: "\u2253",
      Escr: "\u2130",
      escr: "\u212F",
      esdot: "\u2250",
      Esim: "\u2A73",
      esim: "\u2242",
      Eta: "\u0397",
      eta: "\u03B7",
      ETH: "\xD0",
      eth: "\xF0",
      Euml: "\xCB",
      euml: "\xEB",
      euro: "\u20AC",
      excl: "!",
      exist: "\u2203",
      Exists: "\u2203",
      expectation: "\u2130",
      ExponentialE: "\u2147",
      exponentiale: "\u2147",
      fallingdotseq: "\u2252",
      Fcy: "\u0424",
      fcy: "\u0444",
      female: "\u2640",
      ffilig: "\uFB03",
      fflig: "\uFB00",
      ffllig: "\uFB04",
      Ffr: "\u{1D509}",
      ffr: "\u{1D523}",
      filig: "\uFB01",
      FilledSmallSquare: "\u25FC",
      FilledVerySmallSquare: "\u25AA",
      fjlig: "fj",
      flat: "\u266D",
      fllig: "\uFB02",
      fltns: "\u25B1",
      fnof: "\u0192",
      Fopf: "\u{1D53D}",
      fopf: "\u{1D557}",
      ForAll: "\u2200",
      forall: "\u2200",
      fork: "\u22D4",
      forkv: "\u2AD9",
      Fouriertrf: "\u2131",
      fpartint: "\u2A0D",
      frac12: "\xBD",
      frac13: "\u2153",
      frac14: "\xBC",
      frac15: "\u2155",
      frac16: "\u2159",
      frac18: "\u215B",
      frac23: "\u2154",
      frac25: "\u2156",
      frac34: "\xBE",
      frac35: "\u2157",
      frac38: "\u215C",
      frac45: "\u2158",
      frac56: "\u215A",
      frac58: "\u215D",
      frac78: "\u215E",
      frasl: "\u2044",
      frown: "\u2322",
      Fscr: "\u2131",
      fscr: "\u{1D4BB}",
      gacute: "\u01F5",
      Gamma: "\u0393",
      gamma: "\u03B3",
      Gammad: "\u03DC",
      gammad: "\u03DD",
      gap: "\u2A86",
      Gbreve: "\u011E",
      gbreve: "\u011F",
      Gcedil: "\u0122",
      Gcirc: "\u011C",
      gcirc: "\u011D",
      Gcy: "\u0413",
      gcy: "\u0433",
      Gdot: "\u0120",
      gdot: "\u0121",
      gE: "\u2267",
      ge: "\u2265",
      gEl: "\u2A8C",
      gel: "\u22DB",
      geq: "\u2265",
      geqq: "\u2267",
      geqslant: "\u2A7E",
      ges: "\u2A7E",
      gescc: "\u2AA9",
      gesdot: "\u2A80",
      gesdoto: "\u2A82",
      gesdotol: "\u2A84",
      gesl: "\u22DB\uFE00",
      gesles: "\u2A94",
      Gfr: "\u{1D50A}",
      gfr: "\u{1D524}",
      Gg: "\u22D9",
      gg: "\u226B",
      ggg: "\u22D9",
      gimel: "\u2137",
      GJcy: "\u0403",
      gjcy: "\u0453",
      gl: "\u2277",
      gla: "\u2AA5",
      glE: "\u2A92",
      glj: "\u2AA4",
      gnap: "\u2A8A",
      gnapprox: "\u2A8A",
      gnE: "\u2269",
      gne: "\u2A88",
      gneq: "\u2A88",
      gneqq: "\u2269",
      gnsim: "\u22E7",
      Gopf: "\u{1D53E}",
      gopf: "\u{1D558}",
      grave: "`",
      GreaterEqual: "\u2265",
      GreaterEqualLess: "\u22DB",
      GreaterFullEqual: "\u2267",
      GreaterGreater: "\u2AA2",
      GreaterLess: "\u2277",
      GreaterSlantEqual: "\u2A7E",
      GreaterTilde: "\u2273",
      Gscr: "\u{1D4A2}",
      gscr: "\u210A",
      gsim: "\u2273",
      gsime: "\u2A8E",
      gsiml: "\u2A90",
      Gt: "\u226B",
      GT: ">",
      gt: ">",
      gtcc: "\u2AA7",
      gtcir: "\u2A7A",
      gtdot: "\u22D7",
      gtlPar: "\u2995",
      gtquest: "\u2A7C",
      gtrapprox: "\u2A86",
      gtrarr: "\u2978",
      gtrdot: "\u22D7",
      gtreqless: "\u22DB",
      gtreqqless: "\u2A8C",
      gtrless: "\u2277",
      gtrsim: "\u2273",
      gvertneqq: "\u2269\uFE00",
      gvnE: "\u2269\uFE00",
      Hacek: "\u02C7",
      hairsp: "\u200A",
      half: "\xBD",
      hamilt: "\u210B",
      HARDcy: "\u042A",
      hardcy: "\u044A",
      hArr: "\u21D4",
      harr: "\u2194",
      harrcir: "\u2948",
      harrw: "\u21AD",
      Hat: "^",
      hbar: "\u210F",
      Hcirc: "\u0124",
      hcirc: "\u0125",
      hearts: "\u2665",
      heartsuit: "\u2665",
      hellip: "\u2026",
      hercon: "\u22B9",
      Hfr: "\u210C",
      hfr: "\u{1D525}",
      HilbertSpace: "\u210B",
      hksearow: "\u2925",
      hkswarow: "\u2926",
      hoarr: "\u21FF",
      homtht: "\u223B",
      hookleftarrow: "\u21A9",
      hookrightarrow: "\u21AA",
      Hopf: "\u210D",
      hopf: "\u{1D559}",
      horbar: "\u2015",
      HorizontalLine: "\u2500",
      Hscr: "\u210B",
      hscr: "\u{1D4BD}",
      hslash: "\u210F",
      Hstrok: "\u0126",
      hstrok: "\u0127",
      HumpDownHump: "\u224E",
      HumpEqual: "\u224F",
      hybull: "\u2043",
      hyphen: "\u2010",
      Iacute: "\xCD",
      iacute: "\xED",
      ic: "\u2063",
      Icirc: "\xCE",
      icirc: "\xEE",
      Icy: "\u0418",
      icy: "\u0438",
      Idot: "\u0130",
      IEcy: "\u0415",
      iecy: "\u0435",
      iexcl: "\xA1",
      iff: "\u21D4",
      Ifr: "\u2111",
      ifr: "\u{1D526}",
      Igrave: "\xCC",
      igrave: "\xEC",
      ii: "\u2148",
      iiiint: "\u2A0C",
      iiint: "\u222D",
      iinfin: "\u29DC",
      iiota: "\u2129",
      IJlig: "\u0132",
      ijlig: "\u0133",
      Im: "\u2111",
      Imacr: "\u012A",
      imacr: "\u012B",
      image: "\u2111",
      ImaginaryI: "\u2148",
      imagline: "\u2110",
      imagpart: "\u2111",
      imath: "\u0131",
      imof: "\u22B7",
      imped: "\u01B5",
      Implies: "\u21D2",
      in: "\u2208",
      incare: "\u2105",
      infin: "\u221E",
      infintie: "\u29DD",
      inodot: "\u0131",
      Int: "\u222C",
      int: "\u222B",
      intcal: "\u22BA",
      integers: "\u2124",
      Integral: "\u222B",
      intercal: "\u22BA",
      Intersection: "\u22C2",
      intlarhk: "\u2A17",
      intprod: "\u2A3C",
      InvisibleComma: "\u2063",
      InvisibleTimes: "\u2062",
      IOcy: "\u0401",
      iocy: "\u0451",
      Iogon: "\u012E",
      iogon: "\u012F",
      Iopf: "\u{1D540}",
      iopf: "\u{1D55A}",
      Iota: "\u0399",
      iota: "\u03B9",
      iprod: "\u2A3C",
      iquest: "\xBF",
      Iscr: "\u2110",
      iscr: "\u{1D4BE}",
      isin: "\u2208",
      isindot: "\u22F5",
      isinE: "\u22F9",
      isins: "\u22F4",
      isinsv: "\u22F3",
      isinv: "\u2208",
      it: "\u2062",
      Itilde: "\u0128",
      itilde: "\u0129",
      Iukcy: "\u0406",
      iukcy: "\u0456",
      Iuml: "\xCF",
      iuml: "\xEF",
      Jcirc: "\u0134",
      jcirc: "\u0135",
      Jcy: "\u0419",
      jcy: "\u0439",
      Jfr: "\u{1D50D}",
      jfr: "\u{1D527}",
      jmath: "\u0237",
      Jopf: "\u{1D541}",
      jopf: "\u{1D55B}",
      Jscr: "\u{1D4A5}",
      jscr: "\u{1D4BF}",
      Jsercy: "\u0408",
      jsercy: "\u0458",
      Jukcy: "\u0404",
      jukcy: "\u0454",
      Kappa: "\u039A",
      kappa: "\u03BA",
      kappav: "\u03F0",
      Kcedil: "\u0136",
      kcedil: "\u0137",
      Kcy: "\u041A",
      kcy: "\u043A",
      Kfr: "\u{1D50E}",
      kfr: "\u{1D528}",
      kgreen: "\u0138",
      KHcy: "\u0425",
      khcy: "\u0445",
      KJcy: "\u040C",
      kjcy: "\u045C",
      Kopf: "\u{1D542}",
      kopf: "\u{1D55C}",
      Kscr: "\u{1D4A6}",
      kscr: "\u{1D4C0}",
      lAarr: "\u21DA",
      Lacute: "\u0139",
      lacute: "\u013A",
      laemptyv: "\u29B4",
      lagran: "\u2112",
      Lambda: "\u039B",
      lambda: "\u03BB",
      Lang: "\u27EA",
      lang: "\u27E8",
      langd: "\u2991",
      langle: "\u27E8",
      lap: "\u2A85",
      Laplacetrf: "\u2112",
      laquo: "\xAB",
      Larr: "\u219E",
      lArr: "\u21D0",
      larr: "\u2190",
      larrb: "\u21E4",
      larrbfs: "\u291F",
      larrfs: "\u291D",
      larrhk: "\u21A9",
      larrlp: "\u21AB",
      larrpl: "\u2939",
      larrsim: "\u2973",
      larrtl: "\u21A2",
      lat: "\u2AAB",
      lAtail: "\u291B",
      latail: "\u2919",
      late: "\u2AAD",
      lates: "\u2AAD\uFE00",
      lBarr: "\u290E",
      lbarr: "\u290C",
      lbbrk: "\u2772",
      lbrace: "{",
      lbrack: "[",
      lbrke: "\u298B",
      lbrksld: "\u298F",
      lbrkslu: "\u298D",
      Lcaron: "\u013D",
      lcaron: "\u013E",
      Lcedil: "\u013B",
      lcedil: "\u013C",
      lceil: "\u2308",
      lcub: "{",
      Lcy: "\u041B",
      lcy: "\u043B",
      ldca: "\u2936",
      ldquo: "\u201C",
      ldquor: "\u201E",
      ldrdhar: "\u2967",
      ldrushar: "\u294B",
      ldsh: "\u21B2",
      lE: "\u2266",
      le: "\u2264",
      LeftAngleBracket: "\u27E8",
      LeftArrow: "\u2190",
      Leftarrow: "\u21D0",
      leftarrow: "\u2190",
      LeftArrowBar: "\u21E4",
      LeftArrowRightArrow: "\u21C6",
      leftarrowtail: "\u21A2",
      LeftCeiling: "\u2308",
      LeftDoubleBracket: "\u27E6",
      LeftDownTeeVector: "\u2961",
      LeftDownVector: "\u21C3",
      LeftDownVectorBar: "\u2959",
      LeftFloor: "\u230A",
      leftharpoondown: "\u21BD",
      leftharpoonup: "\u21BC",
      leftleftarrows: "\u21C7",
      LeftRightArrow: "\u2194",
      Leftrightarrow: "\u21D4",
      leftrightarrow: "\u2194",
      leftrightarrows: "\u21C6",
      leftrightharpoons: "\u21CB",
      leftrightsquigarrow: "\u21AD",
      LeftRightVector: "\u294E",
      LeftTee: "\u22A3",
      LeftTeeArrow: "\u21A4",
      LeftTeeVector: "\u295A",
      leftthreetimes: "\u22CB",
      LeftTriangle: "\u22B2",
      LeftTriangleBar: "\u29CF",
      LeftTriangleEqual: "\u22B4",
      LeftUpDownVector: "\u2951",
      LeftUpTeeVector: "\u2960",
      LeftUpVector: "\u21BF",
      LeftUpVectorBar: "\u2958",
      LeftVector: "\u21BC",
      LeftVectorBar: "\u2952",
      lEg: "\u2A8B",
      leg: "\u22DA",
      leq: "\u2264",
      leqq: "\u2266",
      leqslant: "\u2A7D",
      les: "\u2A7D",
      lescc: "\u2AA8",
      lesdot: "\u2A7F",
      lesdoto: "\u2A81",
      lesdotor: "\u2A83",
      lesg: "\u22DA\uFE00",
      lesges: "\u2A93",
      lessapprox: "\u2A85",
      lessdot: "\u22D6",
      lesseqgtr: "\u22DA",
      lesseqqgtr: "\u2A8B",
      LessEqualGreater: "\u22DA",
      LessFullEqual: "\u2266",
      LessGreater: "\u2276",
      lessgtr: "\u2276",
      LessLess: "\u2AA1",
      lesssim: "\u2272",
      LessSlantEqual: "\u2A7D",
      LessTilde: "\u2272",
      lfisht: "\u297C",
      lfloor: "\u230A",
      Lfr: "\u{1D50F}",
      lfr: "\u{1D529}",
      lg: "\u2276",
      lgE: "\u2A91",
      lHar: "\u2962",
      lhard: "\u21BD",
      lharu: "\u21BC",
      lharul: "\u296A",
      lhblk: "\u2584",
      LJcy: "\u0409",
      ljcy: "\u0459",
      Ll: "\u22D8",
      ll: "\u226A",
      llarr: "\u21C7",
      llcorner: "\u231E",
      Lleftarrow: "\u21DA",
      llhard: "\u296B",
      lltri: "\u25FA",
      Lmidot: "\u013F",
      lmidot: "\u0140",
      lmoust: "\u23B0",
      lmoustache: "\u23B0",
      lnap: "\u2A89",
      lnapprox: "\u2A89",
      lnE: "\u2268",
      lne: "\u2A87",
      lneq: "\u2A87",
      lneqq: "\u2268",
      lnsim: "\u22E6",
      loang: "\u27EC",
      loarr: "\u21FD",
      lobrk: "\u27E6",
      LongLeftArrow: "\u27F5",
      Longleftarrow: "\u27F8",
      longleftarrow: "\u27F5",
      LongLeftRightArrow: "\u27F7",
      Longleftrightarrow: "\u27FA",
      longleftrightarrow: "\u27F7",
      longmapsto: "\u27FC",
      LongRightArrow: "\u27F6",
      Longrightarrow: "\u27F9",
      longrightarrow: "\u27F6",
      looparrowleft: "\u21AB",
      looparrowright: "\u21AC",
      lopar: "\u2985",
      Lopf: "\u{1D543}",
      lopf: "\u{1D55D}",
      loplus: "\u2A2D",
      lotimes: "\u2A34",
      lowast: "\u2217",
      lowbar: "_",
      LowerLeftArrow: "\u2199",
      LowerRightArrow: "\u2198",
      loz: "\u25CA",
      lozenge: "\u25CA",
      lozf: "\u29EB",
      lpar: "(",
      lparlt: "\u2993",
      lrarr: "\u21C6",
      lrcorner: "\u231F",
      lrhar: "\u21CB",
      lrhard: "\u296D",
      lrm: "\u200E",
      lrtri: "\u22BF",
      lsaquo: "\u2039",
      Lscr: "\u2112",
      lscr: "\u{1D4C1}",
      Lsh: "\u21B0",
      lsh: "\u21B0",
      lsim: "\u2272",
      lsime: "\u2A8D",
      lsimg: "\u2A8F",
      lsqb: "[",
      lsquo: "\u2018",
      lsquor: "\u201A",
      Lstrok: "\u0141",
      lstrok: "\u0142",
      Lt: "\u226A",
      LT: "<",
      lt: "<",
      ltcc: "\u2AA6",
      ltcir: "\u2A79",
      ltdot: "\u22D6",
      lthree: "\u22CB",
      ltimes: "\u22C9",
      ltlarr: "\u2976",
      ltquest: "\u2A7B",
      ltri: "\u25C3",
      ltrie: "\u22B4",
      ltrif: "\u25C2",
      ltrPar: "\u2996",
      lurdshar: "\u294A",
      luruhar: "\u2966",
      lvertneqq: "\u2268\uFE00",
      lvnE: "\u2268\uFE00",
      macr: "\xAF",
      male: "\u2642",
      malt: "\u2720",
      maltese: "\u2720",
      Map: "\u2905",
      map: "\u21A6",
      mapsto: "\u21A6",
      mapstodown: "\u21A7",
      mapstoleft: "\u21A4",
      mapstoup: "\u21A5",
      marker: "\u25AE",
      mcomma: "\u2A29",
      Mcy: "\u041C",
      mcy: "\u043C",
      mdash: "\u2014",
      mDDot: "\u223A",
      measuredangle: "\u2221",
      MediumSpace: "\u205F",
      Mellintrf: "\u2133",
      Mfr: "\u{1D510}",
      mfr: "\u{1D52A}",
      mho: "\u2127",
      micro: "\xB5",
      mid: "\u2223",
      midast: "*",
      midcir: "\u2AF0",
      middot: "\xB7",
      minus: "\u2212",
      minusb: "\u229F",
      minusd: "\u2238",
      minusdu: "\u2A2A",
      MinusPlus: "\u2213",
      mlcp: "\u2ADB",
      mldr: "\u2026",
      mnplus: "\u2213",
      models: "\u22A7",
      Mopf: "\u{1D544}",
      mopf: "\u{1D55E}",
      mp: "\u2213",
      Mscr: "\u2133",
      mscr: "\u{1D4C2}",
      mstpos: "\u223E",
      Mu: "\u039C",
      mu: "\u03BC",
      multimap: "\u22B8",
      mumap: "\u22B8",
      nabla: "\u2207",
      Nacute: "\u0143",
      nacute: "\u0144",
      nang: "\u2220\u20D2",
      nap: "\u2249",
      napE: "\u2A70\u0338",
      napid: "\u224B\u0338",
      napos: "\u0149",
      napprox: "\u2249",
      natur: "\u266E",
      natural: "\u266E",
      naturals: "\u2115",
      nbsp: "\xA0",
      nbump: "\u224E\u0338",
      nbumpe: "\u224F\u0338",
      ncap: "\u2A43",
      Ncaron: "\u0147",
      ncaron: "\u0148",
      Ncedil: "\u0145",
      ncedil: "\u0146",
      ncong: "\u2247",
      ncongdot: "\u2A6D\u0338",
      ncup: "\u2A42",
      Ncy: "\u041D",
      ncy: "\u043D",
      ndash: "\u2013",
      ne: "\u2260",
      nearhk: "\u2924",
      neArr: "\u21D7",
      nearr: "\u2197",
      nearrow: "\u2197",
      nedot: "\u2250\u0338",
      NegativeMediumSpace: "\u200B",
      NegativeThickSpace: "\u200B",
      NegativeThinSpace: "\u200B",
      NegativeVeryThinSpace: "\u200B",
      nequiv: "\u2262",
      nesear: "\u2928",
      nesim: "\u2242\u0338",
      NestedGreaterGreater: "\u226B",
      NestedLessLess: "\u226A",
      NewLine: "\n",
      nexist: "\u2204",
      nexists: "\u2204",
      Nfr: "\u{1D511}",
      nfr: "\u{1D52B}",
      ngE: "\u2267\u0338",
      nge: "\u2271",
      ngeq: "\u2271",
      ngeqq: "\u2267\u0338",
      ngeqslant: "\u2A7E\u0338",
      nges: "\u2A7E\u0338",
      nGg: "\u22D9\u0338",
      ngsim: "\u2275",
      nGt: "\u226B\u20D2",
      ngt: "\u226F",
      ngtr: "\u226F",
      nGtv: "\u226B\u0338",
      nhArr: "\u21CE",
      nharr: "\u21AE",
      nhpar: "\u2AF2",
      ni: "\u220B",
      nis: "\u22FC",
      nisd: "\u22FA",
      niv: "\u220B",
      NJcy: "\u040A",
      njcy: "\u045A",
      nlArr: "\u21CD",
      nlarr: "\u219A",
      nldr: "\u2025",
      nlE: "\u2266\u0338",
      nle: "\u2270",
      nLeftarrow: "\u21CD",
      nleftarrow: "\u219A",
      nLeftrightarrow: "\u21CE",
      nleftrightarrow: "\u21AE",
      nleq: "\u2270",
      nleqq: "\u2266\u0338",
      nleqslant: "\u2A7D\u0338",
      nles: "\u2A7D\u0338",
      nless: "\u226E",
      nLl: "\u22D8\u0338",
      nlsim: "\u2274",
      nLt: "\u226A\u20D2",
      nlt: "\u226E",
      nltri: "\u22EA",
      nltrie: "\u22EC",
      nLtv: "\u226A\u0338",
      nmid: "\u2224",
      NoBreak: "\u2060",
      NonBreakingSpace: "\xA0",
      Nopf: "\u2115",
      nopf: "\u{1D55F}",
      Not: "\u2AEC",
      not: "\xAC",
      NotCongruent: "\u2262",
      NotCupCap: "\u226D",
      NotDoubleVerticalBar: "\u2226",
      NotElement: "\u2209",
      NotEqual: "\u2260",
      NotEqualTilde: "\u2242\u0338",
      NotExists: "\u2204",
      NotGreater: "\u226F",
      NotGreaterEqual: "\u2271",
      NotGreaterFullEqual: "\u2267\u0338",
      NotGreaterGreater: "\u226B\u0338",
      NotGreaterLess: "\u2279",
      NotGreaterSlantEqual: "\u2A7E\u0338",
      NotGreaterTilde: "\u2275",
      NotHumpDownHump: "\u224E\u0338",
      NotHumpEqual: "\u224F\u0338",
      notin: "\u2209",
      notindot: "\u22F5\u0338",
      notinE: "\u22F9\u0338",
      notinva: "\u2209",
      notinvb: "\u22F7",
      notinvc: "\u22F6",
      NotLeftTriangle: "\u22EA",
      NotLeftTriangleBar: "\u29CF\u0338",
      NotLeftTriangleEqual: "\u22EC",
      NotLess: "\u226E",
      NotLessEqual: "\u2270",
      NotLessGreater: "\u2278",
      NotLessLess: "\u226A\u0338",
      NotLessSlantEqual: "\u2A7D\u0338",
      NotLessTilde: "\u2274",
      NotNestedGreaterGreater: "\u2AA2\u0338",
      NotNestedLessLess: "\u2AA1\u0338",
      notni: "\u220C",
      notniva: "\u220C",
      notnivb: "\u22FE",
      notnivc: "\u22FD",
      NotPrecedes: "\u2280",
      NotPrecedesEqual: "\u2AAF\u0338",
      NotPrecedesSlantEqual: "\u22E0",
      NotReverseElement: "\u220C",
      NotRightTriangle: "\u22EB",
      NotRightTriangleBar: "\u29D0\u0338",
      NotRightTriangleEqual: "\u22ED",
      NotSquareSubset: "\u228F\u0338",
      NotSquareSubsetEqual: "\u22E2",
      NotSquareSuperset: "\u2290\u0338",
      NotSquareSupersetEqual: "\u22E3",
      NotSubset: "\u2282\u20D2",
      NotSubsetEqual: "\u2288",
      NotSucceeds: "\u2281",
      NotSucceedsEqual: "\u2AB0\u0338",
      NotSucceedsSlantEqual: "\u22E1",
      NotSucceedsTilde: "\u227F\u0338",
      NotSuperset: "\u2283\u20D2",
      NotSupersetEqual: "\u2289",
      NotTilde: "\u2241",
      NotTildeEqual: "\u2244",
      NotTildeFullEqual: "\u2247",
      NotTildeTilde: "\u2249",
      NotVerticalBar: "\u2224",
      npar: "\u2226",
      nparallel: "\u2226",
      nparsl: "\u2AFD\u20E5",
      npart: "\u2202\u0338",
      npolint: "\u2A14",
      npr: "\u2280",
      nprcue: "\u22E0",
      npre: "\u2AAF\u0338",
      nprec: "\u2280",
      npreceq: "\u2AAF\u0338",
      nrArr: "\u21CF",
      nrarr: "\u219B",
      nrarrc: "\u2933\u0338",
      nrarrw: "\u219D\u0338",
      nRightarrow: "\u21CF",
      nrightarrow: "\u219B",
      nrtri: "\u22EB",
      nrtrie: "\u22ED",
      nsc: "\u2281",
      nsccue: "\u22E1",
      nsce: "\u2AB0\u0338",
      Nscr: "\u{1D4A9}",
      nscr: "\u{1D4C3}",
      nshortmid: "\u2224",
      nshortparallel: "\u2226",
      nsim: "\u2241",
      nsime: "\u2244",
      nsimeq: "\u2244",
      nsmid: "\u2224",
      nspar: "\u2226",
      nsqsube: "\u22E2",
      nsqsupe: "\u22E3",
      nsub: "\u2284",
      nsubE: "\u2AC5\u0338",
      nsube: "\u2288",
      nsubset: "\u2282\u20D2",
      nsubseteq: "\u2288",
      nsubseteqq: "\u2AC5\u0338",
      nsucc: "\u2281",
      nsucceq: "\u2AB0\u0338",
      nsup: "\u2285",
      nsupE: "\u2AC6\u0338",
      nsupe: "\u2289",
      nsupset: "\u2283\u20D2",
      nsupseteq: "\u2289",
      nsupseteqq: "\u2AC6\u0338",
      ntgl: "\u2279",
      Ntilde: "\xD1",
      ntilde: "\xF1",
      ntlg: "\u2278",
      ntriangleleft: "\u22EA",
      ntrianglelefteq: "\u22EC",
      ntriangleright: "\u22EB",
      ntrianglerighteq: "\u22ED",
      Nu: "\u039D",
      nu: "\u03BD",
      num: "#",
      numero: "\u2116",
      numsp: "\u2007",
      nvap: "\u224D\u20D2",
      nVDash: "\u22AF",
      nVdash: "\u22AE",
      nvDash: "\u22AD",
      nvdash: "\u22AC",
      nvge: "\u2265\u20D2",
      nvgt: ">\u20D2",
      nvHarr: "\u2904",
      nvinfin: "\u29DE",
      nvlArr: "\u2902",
      nvle: "\u2264\u20D2",
      nvlt: "<\u20D2",
      nvltrie: "\u22B4\u20D2",
      nvrArr: "\u2903",
      nvrtrie: "\u22B5\u20D2",
      nvsim: "\u223C\u20D2",
      nwarhk: "\u2923",
      nwArr: "\u21D6",
      nwarr: "\u2196",
      nwarrow: "\u2196",
      nwnear: "\u2927",
      Oacute: "\xD3",
      oacute: "\xF3",
      oast: "\u229B",
      ocir: "\u229A",
      Ocirc: "\xD4",
      ocirc: "\xF4",
      Ocy: "\u041E",
      ocy: "\u043E",
      odash: "\u229D",
      Odblac: "\u0150",
      odblac: "\u0151",
      odiv: "\u2A38",
      odot: "\u2299",
      odsold: "\u29BC",
      OElig: "\u0152",
      oelig: "\u0153",
      ofcir: "\u29BF",
      Ofr: "\u{1D512}",
      ofr: "\u{1D52C}",
      ogon: "\u02DB",
      Ograve: "\xD2",
      ograve: "\xF2",
      ogt: "\u29C1",
      ohbar: "\u29B5",
      ohm: "\u03A9",
      oint: "\u222E",
      olarr: "\u21BA",
      olcir: "\u29BE",
      olcross: "\u29BB",
      oline: "\u203E",
      olt: "\u29C0",
      Omacr: "\u014C",
      omacr: "\u014D",
      Omega: "\u03A9",
      omega: "\u03C9",
      Omicron: "\u039F",
      omicron: "\u03BF",
      omid: "\u29B6",
      ominus: "\u2296",
      Oopf: "\u{1D546}",
      oopf: "\u{1D560}",
      opar: "\u29B7",
      OpenCurlyDoubleQuote: "\u201C",
      OpenCurlyQuote: "\u2018",
      operp: "\u29B9",
      oplus: "\u2295",
      Or: "\u2A54",
      or: "\u2228",
      orarr: "\u21BB",
      ord: "\u2A5D",
      order: "\u2134",
      orderof: "\u2134",
      ordf: "\xAA",
      ordm: "\xBA",
      origof: "\u22B6",
      oror: "\u2A56",
      orslope: "\u2A57",
      orv: "\u2A5B",
      oS: "\u24C8",
      Oscr: "\u{1D4AA}",
      oscr: "\u2134",
      Oslash: "\xD8",
      oslash: "\xF8",
      osol: "\u2298",
      Otilde: "\xD5",
      otilde: "\xF5",
      Otimes: "\u2A37",
      otimes: "\u2297",
      otimesas: "\u2A36",
      Ouml: "\xD6",
      ouml: "\xF6",
      ovbar: "\u233D",
      OverBar: "\u203E",
      OverBrace: "\u23DE",
      OverBracket: "\u23B4",
      OverParenthesis: "\u23DC",
      par: "\u2225",
      para: "\xB6",
      parallel: "\u2225",
      parsim: "\u2AF3",
      parsl: "\u2AFD",
      part: "\u2202",
      PartialD: "\u2202",
      Pcy: "\u041F",
      pcy: "\u043F",
      percnt: "%",
      period: ".",
      permil: "\u2030",
      perp: "\u22A5",
      pertenk: "\u2031",
      Pfr: "\u{1D513}",
      pfr: "\u{1D52D}",
      Phi: "\u03A6",
      phi: "\u03C6",
      phiv: "\u03D5",
      phmmat: "\u2133",
      phone: "\u260E",
      Pi: "\u03A0",
      pi: "\u03C0",
      pitchfork: "\u22D4",
      piv: "\u03D6",
      planck: "\u210F",
      planckh: "\u210E",
      plankv: "\u210F",
      plus: "+",
      plusacir: "\u2A23",
      plusb: "\u229E",
      pluscir: "\u2A22",
      plusdo: "\u2214",
      plusdu: "\u2A25",
      pluse: "\u2A72",
      PlusMinus: "\xB1",
      plusmn: "\xB1",
      plussim: "\u2A26",
      plustwo: "\u2A27",
      pm: "\xB1",
      Poincareplane: "\u210C",
      pointint: "\u2A15",
      Popf: "\u2119",
      popf: "\u{1D561}",
      pound: "\xA3",
      Pr: "\u2ABB",
      pr: "\u227A",
      prap: "\u2AB7",
      prcue: "\u227C",
      prE: "\u2AB3",
      pre: "\u2AAF",
      prec: "\u227A",
      precapprox: "\u2AB7",
      preccurlyeq: "\u227C",
      Precedes: "\u227A",
      PrecedesEqual: "\u2AAF",
      PrecedesSlantEqual: "\u227C",
      PrecedesTilde: "\u227E",
      preceq: "\u2AAF",
      precnapprox: "\u2AB9",
      precneqq: "\u2AB5",
      precnsim: "\u22E8",
      precsim: "\u227E",
      Prime: "\u2033",
      prime: "\u2032",
      primes: "\u2119",
      prnap: "\u2AB9",
      prnE: "\u2AB5",
      prnsim: "\u22E8",
      prod: "\u220F",
      Product: "\u220F",
      profalar: "\u232E",
      profline: "\u2312",
      profsurf: "\u2313",
      prop: "\u221D",
      Proportion: "\u2237",
      Proportional: "\u221D",
      propto: "\u221D",
      prsim: "\u227E",
      prurel: "\u22B0",
      Pscr: "\u{1D4AB}",
      pscr: "\u{1D4C5}",
      Psi: "\u03A8",
      psi: "\u03C8",
      puncsp: "\u2008",
      Qfr: "\u{1D514}",
      qfr: "\u{1D52E}",
      qint: "\u2A0C",
      Qopf: "\u211A",
      qopf: "\u{1D562}",
      qprime: "\u2057",
      Qscr: "\u{1D4AC}",
      qscr: "\u{1D4C6}",
      quaternions: "\u210D",
      quatint: "\u2A16",
      quest: "?",
      questeq: "\u225F",
      QUOT: '"',
      quot: '"',
      rAarr: "\u21DB",
      race: "\u223D\u0331",
      Racute: "\u0154",
      racute: "\u0155",
      radic: "\u221A",
      raemptyv: "\u29B3",
      Rang: "\u27EB",
      rang: "\u27E9",
      rangd: "\u2992",
      range: "\u29A5",
      rangle: "\u27E9",
      raquo: "\xBB",
      Rarr: "\u21A0",
      rArr: "\u21D2",
      rarr: "\u2192",
      rarrap: "\u2975",
      rarrb: "\u21E5",
      rarrbfs: "\u2920",
      rarrc: "\u2933",
      rarrfs: "\u291E",
      rarrhk: "\u21AA",
      rarrlp: "\u21AC",
      rarrpl: "\u2945",
      rarrsim: "\u2974",
      Rarrtl: "\u2916",
      rarrtl: "\u21A3",
      rarrw: "\u219D",
      rAtail: "\u291C",
      ratail: "\u291A",
      ratio: "\u2236",
      rationals: "\u211A",
      RBarr: "\u2910",
      rBarr: "\u290F",
      rbarr: "\u290D",
      rbbrk: "\u2773",
      rbrace: "}",
      rbrack: "]",
      rbrke: "\u298C",
      rbrksld: "\u298E",
      rbrkslu: "\u2990",
      Rcaron: "\u0158",
      rcaron: "\u0159",
      Rcedil: "\u0156",
      rcedil: "\u0157",
      rceil: "\u2309",
      rcub: "}",
      Rcy: "\u0420",
      rcy: "\u0440",
      rdca: "\u2937",
      rdldhar: "\u2969",
      rdquo: "\u201D",
      rdquor: "\u201D",
      rdsh: "\u21B3",
      Re: "\u211C",
      real: "\u211C",
      realine: "\u211B",
      realpart: "\u211C",
      reals: "\u211D",
      rect: "\u25AD",
      REG: "\xAE",
      reg: "\xAE",
      ReverseElement: "\u220B",
      ReverseEquilibrium: "\u21CB",
      ReverseUpEquilibrium: "\u296F",
      rfisht: "\u297D",
      rfloor: "\u230B",
      Rfr: "\u211C",
      rfr: "\u{1D52F}",
      rHar: "\u2964",
      rhard: "\u21C1",
      rharu: "\u21C0",
      rharul: "\u296C",
      Rho: "\u03A1",
      rho: "\u03C1",
      rhov: "\u03F1",
      RightAngleBracket: "\u27E9",
      RightArrow: "\u2192",
      Rightarrow: "\u21D2",
      rightarrow: "\u2192",
      RightArrowBar: "\u21E5",
      RightArrowLeftArrow: "\u21C4",
      rightarrowtail: "\u21A3",
      RightCeiling: "\u2309",
      RightDoubleBracket: "\u27E7",
      RightDownTeeVector: "\u295D",
      RightDownVector: "\u21C2",
      RightDownVectorBar: "\u2955",
      RightFloor: "\u230B",
      rightharpoondown: "\u21C1",
      rightharpoonup: "\u21C0",
      rightleftarrows: "\u21C4",
      rightleftharpoons: "\u21CC",
      rightrightarrows: "\u21C9",
      rightsquigarrow: "\u219D",
      RightTee: "\u22A2",
      RightTeeArrow: "\u21A6",
      RightTeeVector: "\u295B",
      rightthreetimes: "\u22CC",
      RightTriangle: "\u22B3",
      RightTriangleBar: "\u29D0",
      RightTriangleEqual: "\u22B5",
      RightUpDownVector: "\u294F",
      RightUpTeeVector: "\u295C",
      RightUpVector: "\u21BE",
      RightUpVectorBar: "\u2954",
      RightVector: "\u21C0",
      RightVectorBar: "\u2953",
      ring: "\u02DA",
      risingdotseq: "\u2253",
      rlarr: "\u21C4",
      rlhar: "\u21CC",
      rlm: "\u200F",
      rmoust: "\u23B1",
      rmoustache: "\u23B1",
      rnmid: "\u2AEE",
      roang: "\u27ED",
      roarr: "\u21FE",
      robrk: "\u27E7",
      ropar: "\u2986",
      Ropf: "\u211D",
      ropf: "\u{1D563}",
      roplus: "\u2A2E",
      rotimes: "\u2A35",
      RoundImplies: "\u2970",
      rpar: ")",
      rpargt: "\u2994",
      rppolint: "\u2A12",
      rrarr: "\u21C9",
      Rrightarrow: "\u21DB",
      rsaquo: "\u203A",
      Rscr: "\u211B",
      rscr: "\u{1D4C7}",
      Rsh: "\u21B1",
      rsh: "\u21B1",
      rsqb: "]",
      rsquo: "\u2019",
      rsquor: "\u2019",
      rthree: "\u22CC",
      rtimes: "\u22CA",
      rtri: "\u25B9",
      rtrie: "\u22B5",
      rtrif: "\u25B8",
      rtriltri: "\u29CE",
      RuleDelayed: "\u29F4",
      ruluhar: "\u2968",
      rx: "\u211E",
      Sacute: "\u015A",
      sacute: "\u015B",
      sbquo: "\u201A",
      Sc: "\u2ABC",
      sc: "\u227B",
      scap: "\u2AB8",
      Scaron: "\u0160",
      scaron: "\u0161",
      sccue: "\u227D",
      scE: "\u2AB4",
      sce: "\u2AB0",
      Scedil: "\u015E",
      scedil: "\u015F",
      Scirc: "\u015C",
      scirc: "\u015D",
      scnap: "\u2ABA",
      scnE: "\u2AB6",
      scnsim: "\u22E9",
      scpolint: "\u2A13",
      scsim: "\u227F",
      Scy: "\u0421",
      scy: "\u0441",
      sdot: "\u22C5",
      sdotb: "\u22A1",
      sdote: "\u2A66",
      searhk: "\u2925",
      seArr: "\u21D8",
      searr: "\u2198",
      searrow: "\u2198",
      sect: "\xA7",
      semi: ";",
      seswar: "\u2929",
      setminus: "\u2216",
      setmn: "\u2216",
      sext: "\u2736",
      Sfr: "\u{1D516}",
      sfr: "\u{1D530}",
      sfrown: "\u2322",
      sharp: "\u266F",
      SHCHcy: "\u0429",
      shchcy: "\u0449",
      SHcy: "\u0428",
      shcy: "\u0448",
      ShortDownArrow: "\u2193",
      ShortLeftArrow: "\u2190",
      shortmid: "\u2223",
      shortparallel: "\u2225",
      ShortRightArrow: "\u2192",
      ShortUpArrow: "\u2191",
      shy: "\xAD",
      Sigma: "\u03A3",
      sigma: "\u03C3",
      sigmaf: "\u03C2",
      sigmav: "\u03C2",
      sim: "\u223C",
      simdot: "\u2A6A",
      sime: "\u2243",
      simeq: "\u2243",
      simg: "\u2A9E",
      simgE: "\u2AA0",
      siml: "\u2A9D",
      simlE: "\u2A9F",
      simne: "\u2246",
      simplus: "\u2A24",
      simrarr: "\u2972",
      slarr: "\u2190",
      SmallCircle: "\u2218",
      smallsetminus: "\u2216",
      smashp: "\u2A33",
      smeparsl: "\u29E4",
      smid: "\u2223",
      smile: "\u2323",
      smt: "\u2AAA",
      smte: "\u2AAC",
      smtes: "\u2AAC\uFE00",
      SOFTcy: "\u042C",
      softcy: "\u044C",
      sol: "/",
      solb: "\u29C4",
      solbar: "\u233F",
      Sopf: "\u{1D54A}",
      sopf: "\u{1D564}",
      spades: "\u2660",
      spadesuit: "\u2660",
      spar: "\u2225",
      sqcap: "\u2293",
      sqcaps: "\u2293\uFE00",
      sqcup: "\u2294",
      sqcups: "\u2294\uFE00",
      Sqrt: "\u221A",
      sqsub: "\u228F",
      sqsube: "\u2291",
      sqsubset: "\u228F",
      sqsubseteq: "\u2291",
      sqsup: "\u2290",
      sqsupe: "\u2292",
      sqsupset: "\u2290",
      sqsupseteq: "\u2292",
      squ: "\u25A1",
      Square: "\u25A1",
      square: "\u25A1",
      SquareIntersection: "\u2293",
      SquareSubset: "\u228F",
      SquareSubsetEqual: "\u2291",
      SquareSuperset: "\u2290",
      SquareSupersetEqual: "\u2292",
      SquareUnion: "\u2294",
      squarf: "\u25AA",
      squf: "\u25AA",
      srarr: "\u2192",
      Sscr: "\u{1D4AE}",
      sscr: "\u{1D4C8}",
      ssetmn: "\u2216",
      ssmile: "\u2323",
      sstarf: "\u22C6",
      Star: "\u22C6",
      star: "\u2606",
      starf: "\u2605",
      straightepsilon: "\u03F5",
      straightphi: "\u03D5",
      strns: "\xAF",
      Sub: "\u22D0",
      sub: "\u2282",
      subdot: "\u2ABD",
      subE: "\u2AC5",
      sube: "\u2286",
      subedot: "\u2AC3",
      submult: "\u2AC1",
      subnE: "\u2ACB",
      subne: "\u228A",
      subplus: "\u2ABF",
      subrarr: "\u2979",
      Subset: "\u22D0",
      subset: "\u2282",
      subseteq: "\u2286",
      subseteqq: "\u2AC5",
      SubsetEqual: "\u2286",
      subsetneq: "\u228A",
      subsetneqq: "\u2ACB",
      subsim: "\u2AC7",
      subsub: "\u2AD5",
      subsup: "\u2AD3",
      succ: "\u227B",
      succapprox: "\u2AB8",
      succcurlyeq: "\u227D",
      Succeeds: "\u227B",
      SucceedsEqual: "\u2AB0",
      SucceedsSlantEqual: "\u227D",
      SucceedsTilde: "\u227F",
      succeq: "\u2AB0",
      succnapprox: "\u2ABA",
      succneqq: "\u2AB6",
      succnsim: "\u22E9",
      succsim: "\u227F",
      SuchThat: "\u220B",
      Sum: "\u2211",
      sum: "\u2211",
      sung: "\u266A",
      Sup: "\u22D1",
      sup: "\u2283",
      sup1: "\xB9",
      sup2: "\xB2",
      sup3: "\xB3",
      supdot: "\u2ABE",
      supdsub: "\u2AD8",
      supE: "\u2AC6",
      supe: "\u2287",
      supedot: "\u2AC4",
      Superset: "\u2283",
      SupersetEqual: "\u2287",
      suphsol: "\u27C9",
      suphsub: "\u2AD7",
      suplarr: "\u297B",
      supmult: "\u2AC2",
      supnE: "\u2ACC",
      supne: "\u228B",
      supplus: "\u2AC0",
      Supset: "\u22D1",
      supset: "\u2283",
      supseteq: "\u2287",
      supseteqq: "\u2AC6",
      supsetneq: "\u228B",
      supsetneqq: "\u2ACC",
      supsim: "\u2AC8",
      supsub: "\u2AD4",
      supsup: "\u2AD6",
      swarhk: "\u2926",
      swArr: "\u21D9",
      swarr: "\u2199",
      swarrow: "\u2199",
      swnwar: "\u292A",
      szlig: "\xDF",
      Tab: "	",
      target: "\u2316",
      Tau: "\u03A4",
      tau: "\u03C4",
      tbrk: "\u23B4",
      Tcaron: "\u0164",
      tcaron: "\u0165",
      Tcedil: "\u0162",
      tcedil: "\u0163",
      Tcy: "\u0422",
      tcy: "\u0442",
      tdot: "\u20DB",
      telrec: "\u2315",
      Tfr: "\u{1D517}",
      tfr: "\u{1D531}",
      there4: "\u2234",
      Therefore: "\u2234",
      therefore: "\u2234",
      Theta: "\u0398",
      theta: "\u03B8",
      thetasym: "\u03D1",
      thetav: "\u03D1",
      thickapprox: "\u2248",
      thicksim: "\u223C",
      ThickSpace: "\u205F\u200A",
      thinsp: "\u2009",
      ThinSpace: "\u2009",
      thkap: "\u2248",
      thksim: "\u223C",
      THORN: "\xDE",
      thorn: "\xFE",
      Tilde: "\u223C",
      tilde: "\u02DC",
      TildeEqual: "\u2243",
      TildeFullEqual: "\u2245",
      TildeTilde: "\u2248",
      times: "\xD7",
      timesb: "\u22A0",
      timesbar: "\u2A31",
      timesd: "\u2A30",
      tint: "\u222D",
      toea: "\u2928",
      top: "\u22A4",
      topbot: "\u2336",
      topcir: "\u2AF1",
      Topf: "\u{1D54B}",
      topf: "\u{1D565}",
      topfork: "\u2ADA",
      tosa: "\u2929",
      tprime: "\u2034",
      TRADE: "\u2122",
      trade: "\u2122",
      triangle: "\u25B5",
      triangledown: "\u25BF",
      triangleleft: "\u25C3",
      trianglelefteq: "\u22B4",
      triangleq: "\u225C",
      triangleright: "\u25B9",
      trianglerighteq: "\u22B5",
      tridot: "\u25EC",
      trie: "\u225C",
      triminus: "\u2A3A",
      TripleDot: "\u20DB",
      triplus: "\u2A39",
      trisb: "\u29CD",
      tritime: "\u2A3B",
      trpezium: "\u23E2",
      Tscr: "\u{1D4AF}",
      tscr: "\u{1D4C9}",
      TScy: "\u0426",
      tscy: "\u0446",
      TSHcy: "\u040B",
      tshcy: "\u045B",
      Tstrok: "\u0166",
      tstrok: "\u0167",
      twixt: "\u226C",
      twoheadleftarrow: "\u219E",
      twoheadrightarrow: "\u21A0",
      Uacute: "\xDA",
      uacute: "\xFA",
      Uarr: "\u219F",
      uArr: "\u21D1",
      uarr: "\u2191",
      Uarrocir: "\u2949",
      Ubrcy: "\u040E",
      ubrcy: "\u045E",
      Ubreve: "\u016C",
      ubreve: "\u016D",
      Ucirc: "\xDB",
      ucirc: "\xFB",
      Ucy: "\u0423",
      ucy: "\u0443",
      udarr: "\u21C5",
      Udblac: "\u0170",
      udblac: "\u0171",
      udhar: "\u296E",
      ufisht: "\u297E",
      Ufr: "\u{1D518}",
      ufr: "\u{1D532}",
      Ugrave: "\xD9",
      ugrave: "\xF9",
      uHar: "\u2963",
      uharl: "\u21BF",
      uharr: "\u21BE",
      uhblk: "\u2580",
      ulcorn: "\u231C",
      ulcorner: "\u231C",
      ulcrop: "\u230F",
      ultri: "\u25F8",
      Umacr: "\u016A",
      umacr: "\u016B",
      uml: "\xA8",
      UnderBar: "_",
      UnderBrace: "\u23DF",
      UnderBracket: "\u23B5",
      UnderParenthesis: "\u23DD",
      Union: "\u22C3",
      UnionPlus: "\u228E",
      Uogon: "\u0172",
      uogon: "\u0173",
      Uopf: "\u{1D54C}",
      uopf: "\u{1D566}",
      UpArrow: "\u2191",
      Uparrow: "\u21D1",
      uparrow: "\u2191",
      UpArrowBar: "\u2912",
      UpArrowDownArrow: "\u21C5",
      UpDownArrow: "\u2195",
      Updownarrow: "\u21D5",
      updownarrow: "\u2195",
      UpEquilibrium: "\u296E",
      upharpoonleft: "\u21BF",
      upharpoonright: "\u21BE",
      uplus: "\u228E",
      UpperLeftArrow: "\u2196",
      UpperRightArrow: "\u2197",
      Upsi: "\u03D2",
      upsi: "\u03C5",
      upsih: "\u03D2",
      Upsilon: "\u03A5",
      upsilon: "\u03C5",
      UpTee: "\u22A5",
      UpTeeArrow: "\u21A5",
      upuparrows: "\u21C8",
      urcorn: "\u231D",
      urcorner: "\u231D",
      urcrop: "\u230E",
      Uring: "\u016E",
      uring: "\u016F",
      urtri: "\u25F9",
      Uscr: "\u{1D4B0}",
      uscr: "\u{1D4CA}",
      utdot: "\u22F0",
      Utilde: "\u0168",
      utilde: "\u0169",
      utri: "\u25B5",
      utrif: "\u25B4",
      uuarr: "\u21C8",
      Uuml: "\xDC",
      uuml: "\xFC",
      uwangle: "\u29A7",
      vangrt: "\u299C",
      varepsilon: "\u03F5",
      varkappa: "\u03F0",
      varnothing: "\u2205",
      varphi: "\u03D5",
      varpi: "\u03D6",
      varpropto: "\u221D",
      vArr: "\u21D5",
      varr: "\u2195",
      varrho: "\u03F1",
      varsigma: "\u03C2",
      varsubsetneq: "\u228A\uFE00",
      varsubsetneqq: "\u2ACB\uFE00",
      varsupsetneq: "\u228B\uFE00",
      varsupsetneqq: "\u2ACC\uFE00",
      vartheta: "\u03D1",
      vartriangleleft: "\u22B2",
      vartriangleright: "\u22B3",
      Vbar: "\u2AEB",
      vBar: "\u2AE8",
      vBarv: "\u2AE9",
      Vcy: "\u0412",
      vcy: "\u0432",
      VDash: "\u22AB",
      Vdash: "\u22A9",
      vDash: "\u22A8",
      vdash: "\u22A2",
      Vdashl: "\u2AE6",
      Vee: "\u22C1",
      vee: "\u2228",
      veebar: "\u22BB",
      veeeq: "\u225A",
      vellip: "\u22EE",
      Verbar: "\u2016",
      verbar: "|",
      Vert: "\u2016",
      vert: "|",
      VerticalBar: "\u2223",
      VerticalLine: "|",
      VerticalSeparator: "\u2758",
      VerticalTilde: "\u2240",
      VeryThinSpace: "\u200A",
      Vfr: "\u{1D519}",
      vfr: "\u{1D533}",
      vltri: "\u22B2",
      vnsub: "\u2282\u20D2",
      vnsup: "\u2283\u20D2",
      Vopf: "\u{1D54D}",
      vopf: "\u{1D567}",
      vprop: "\u221D",
      vrtri: "\u22B3",
      Vscr: "\u{1D4B1}",
      vscr: "\u{1D4CB}",
      vsubnE: "\u2ACB\uFE00",
      vsubne: "\u228A\uFE00",
      vsupnE: "\u2ACC\uFE00",
      vsupne: "\u228B\uFE00",
      Vvdash: "\u22AA",
      vzigzag: "\u299A",
      Wcirc: "\u0174",
      wcirc: "\u0175",
      wedbar: "\u2A5F",
      Wedge: "\u22C0",
      wedge: "\u2227",
      wedgeq: "\u2259",
      weierp: "\u2118",
      Wfr: "\u{1D51A}",
      wfr: "\u{1D534}",
      Wopf: "\u{1D54E}",
      wopf: "\u{1D568}",
      wp: "\u2118",
      wr: "\u2240",
      wreath: "\u2240",
      Wscr: "\u{1D4B2}",
      wscr: "\u{1D4CC}",
      xcap: "\u22C2",
      xcirc: "\u25EF",
      xcup: "\u22C3",
      xdtri: "\u25BD",
      Xfr: "\u{1D51B}",
      xfr: "\u{1D535}",
      xhArr: "\u27FA",
      xharr: "\u27F7",
      Xi: "\u039E",
      xi: "\u03BE",
      xlArr: "\u27F8",
      xlarr: "\u27F5",
      xmap: "\u27FC",
      xnis: "\u22FB",
      xodot: "\u2A00",
      Xopf: "\u{1D54F}",
      xopf: "\u{1D569}",
      xoplus: "\u2A01",
      xotime: "\u2A02",
      xrArr: "\u27F9",
      xrarr: "\u27F6",
      Xscr: "\u{1D4B3}",
      xscr: "\u{1D4CD}",
      xsqcup: "\u2A06",
      xuplus: "\u2A04",
      xutri: "\u25B3",
      xvee: "\u22C1",
      xwedge: "\u22C0",
      Yacute: "\xDD",
      yacute: "\xFD",
      YAcy: "\u042F",
      yacy: "\u044F",
      Ycirc: "\u0176",
      ycirc: "\u0177",
      Ycy: "\u042B",
      ycy: "\u044B",
      yen: "\xA5",
      Yfr: "\u{1D51C}",
      yfr: "\u{1D536}",
      YIcy: "\u0407",
      yicy: "\u0457",
      Yopf: "\u{1D550}",
      yopf: "\u{1D56A}",
      Yscr: "\u{1D4B4}",
      yscr: "\u{1D4CE}",
      YUcy: "\u042E",
      yucy: "\u044E",
      Yuml: "\u0178",
      yuml: "\xFF",
      Zacute: "\u0179",
      zacute: "\u017A",
      Zcaron: "\u017D",
      zcaron: "\u017E",
      Zcy: "\u0417",
      zcy: "\u0437",
      Zdot: "\u017B",
      zdot: "\u017C",
      zeetrf: "\u2128",
      ZeroWidthSpace: "\u200B",
      Zeta: "\u0396",
      zeta: "\u03B6",
      Zfr: "\u2128",
      zfr: "\u{1D537}",
      ZHcy: "\u0416",
      zhcy: "\u0436",
      zigrarr: "\u21DD",
      Zopf: "\u2124",
      zopf: "\u{1D56B}",
      Zscr: "\u{1D4B5}",
      zscr: "\u{1D4CF}",
      zwj: "\u200D",
      zwnj: "\u200C"
    });
    exports.entityMap = exports.HTML_ENTITIES;
  }
});

// work/browser-build/node_modules/@xmldom/xmldom/lib/sax.js
var require_sax = __commonJS({
  "work/browser-build/node_modules/@xmldom/xmldom/lib/sax.js"(exports) {
    var NAMESPACE = require_conventions().NAMESPACE;
    var tagNamePattern = require_conventions().tagNamePattern;
    var S_TAG = 0;
    var S_ATTR = 1;
    var S_ATTR_SPACE = 2;
    var S_EQ = 3;
    var S_ATTR_NOQUOT_VALUE = 4;
    var S_ATTR_END = 5;
    var S_TAG_SPACE = 6;
    var S_TAG_CLOSE = 7;
    function ParseError(message, locator) {
      this.message = message;
      this.locator = locator;
      if (Error.captureStackTrace) Error.captureStackTrace(this, ParseError);
    }
    ParseError.prototype = new Error();
    ParseError.prototype.name = ParseError.name;
    function XMLReader() {
    }
    XMLReader.prototype = {
      parse: function(source, defaultNSMap, entityMap) {
        var domBuilder = this.domBuilder;
        domBuilder.startDocument();
        _copy(defaultNSMap, defaultNSMap = {});
        parse2(
          source,
          defaultNSMap,
          entityMap,
          domBuilder,
          this.errorHandler
        );
        domBuilder.endDocument();
      }
    };
    function parse2(source, defaultNSMapCopy, entityMap, domBuilder, errorHandler) {
      function fixedFromCharCode(code) {
        if (code > 65535) {
          code -= 65536;
          var surrogate1 = 55296 + (code >> 10), surrogate2 = 56320 + (code & 1023);
          return String.fromCharCode(surrogate1, surrogate2);
        } else {
          return String.fromCharCode(code);
        }
      }
      function entityReplacer(a2) {
        var k = a2.slice(1, -1);
        if (Object.hasOwnProperty.call(entityMap, k)) {
          return entityMap[k];
        } else if (k.charAt(0) === "#") {
          return fixedFromCharCode(parseInt(k.substr(1).replace("x", "0x")));
        } else {
          errorHandler.error("entity not found:" + a2);
          return a2;
        }
      }
      function appendText(end2) {
        if (end2 > start) {
          var xt = source.substring(start, end2).replace(/&#?\w+;/g, entityReplacer);
          locator && position(start);
          domBuilder.characters(xt, 0, end2 - start);
          start = end2;
        }
      }
      function position(p, m) {
        while (p >= lineEnd && (m = linePattern.exec(source))) {
          lineStart = m.index;
          lineEnd = lineStart + m[0].length;
          locator.lineNumber++;
        }
        locator.columnNumber = p - lineStart + 1;
      }
      var lineStart = 0;
      var lineEnd = 0;
      var linePattern = /.*(?:\r\n?|\n)|.*$/g;
      var locator = domBuilder.locator;
      var parseStack = [{ currentNSMap: defaultNSMapCopy }];
      var closeMap = {};
      var start = 0;
      while (true) {
        try {
          var tagStart = source.indexOf("<", start);
          if (tagStart < 0) {
            if (!source.substr(start).match(/^\s*$/)) {
              var doc = domBuilder.doc;
              var text = doc.createTextNode(source.substr(start));
              doc.appendChild(text);
              domBuilder.currentElement = text;
            }
            return;
          }
          if (tagStart > start) {
            appendText(tagStart);
          }
          switch (source.charAt(tagStart + 1)) {
            case "/":
              var end = source.indexOf(">", tagStart + 3);
              var tagName = source.substring(tagStart + 2, end).replace(/^([\s\S]*?[^ \t\n\r])?[ \t\n\r]*$/, "$1");
              var config = parseStack.pop();
              if (end < 0) {
                tagName = source.substring(tagStart + 2).replace(/[\s<].*/, "");
                errorHandler.error("end tag name: " + tagName + " is not complete:" + config.tagName);
                end = tagStart + 1 + tagName.length;
              } else if (tagName.match(/\s</)) {
                tagName = tagName.replace(/[\s<].*/, "");
                errorHandler.error("end tag name: " + tagName + " maybe not complete");
                end = tagStart + 1 + tagName.length;
              } else if (/[ \t\n\r]/.test(tagName) && tagNamePattern.test(tagName.split(/[ \t\n\r]/)[0])) {
                errorHandler.error('end tag name is followed by whitespace and trailing content: "' + tagName + '"');
              }
              var localNSMap = config.localNSMap;
              var endMatch = config.tagName == tagName;
              var endIgnoreCaseMach = endMatch || config.tagName && config.tagName.toLowerCase() == tagName.toLowerCase();
              if (endIgnoreCaseMach) {
                domBuilder.endElement(config.uri, config.localName, tagName);
                if (localNSMap) {
                  for (var prefix in localNSMap) {
                    if (Object.prototype.hasOwnProperty.call(localNSMap, prefix)) {
                      domBuilder.endPrefixMapping(prefix);
                    }
                  }
                }
                if (!endMatch) {
                  errorHandler.fatalError("end tag name: " + tagName + " is not match the current start tagName:" + config.tagName);
                }
              } else {
                parseStack.push(config);
              }
              end++;
              break;
            // end elment
            case "?":
              locator && position(tagStart);
              end = parseInstruction(source, tagStart, domBuilder);
              break;
            case "!":
              locator && position(tagStart);
              end = parseDCC(source, tagStart, domBuilder, errorHandler);
              break;
            default:
              locator && position(tagStart);
              var el = new ElementAttributes();
              var currentNSMap = parseStack[parseStack.length - 1].currentNSMap;
              var end = parseElementStartPart(source, tagStart, el, currentNSMap, entityReplacer, errorHandler);
              var len = el.length;
              if (!el.closed && fixSelfClosed(source, end, el.tagName, closeMap)) {
                el.closed = true;
                if (!entityMap.nbsp) {
                  errorHandler.warning("unclosed xml attribute");
                }
              }
              if (locator && len) {
                var locator2 = copyLocator(locator, {});
                for (var i = 0; i < len; i++) {
                  var a = el[i];
                  position(a.offset);
                  a.locator = copyLocator(locator, {});
                }
                domBuilder.locator = locator2;
                if (appendElement(el, domBuilder, currentNSMap)) {
                  parseStack.push(el);
                }
                domBuilder.locator = locator;
              } else {
                if (appendElement(el, domBuilder, currentNSMap)) {
                  parseStack.push(el);
                }
              }
              if (NAMESPACE.isHTML(el.uri) && !el.closed) {
                end = parseHtmlSpecialContent(source, end, el.tagName, entityReplacer, domBuilder);
              } else {
                end++;
              }
          }
        } catch (e) {
          if (e instanceof ParseError) {
            throw e;
          }
          errorHandler.error("element parse error: " + e);
          end = -1;
        }
        if (end > start) {
          start = end;
        } else {
          appendText(Math.max(tagStart, start) + 1);
        }
      }
    }
    function copyLocator(f, t) {
      t.lineNumber = f.lineNumber;
      t.columnNumber = f.columnNumber;
      return t;
    }
    function parseElementStartPart(source, start, el, currentNSMap, entityReplacer, errorHandler) {
      function addAttribute(qname, value2, startIndex) {
        if (el.attributeNames.hasOwnProperty(qname)) {
          errorHandler.fatalError("Attribute " + qname + " redefined");
        }
        el.addValue(
          qname,
          // @see https://www.w3.org/TR/xml/#AVNormalize
          // since the xmldom sax parser does not "interpret" DTD the following is not implemented:
          // - recursive replacement of (DTD) entity references
          // - trimming and collapsing multiple spaces into a single one for attributes that are not of type CDATA
          value2.replace(/[\t\n\r]/g, " ").replace(/&#?\w+;/g, entityReplacer),
          startIndex
        );
      }
      var attrName;
      var value;
      var p = ++start;
      var s = S_TAG;
      while (true) {
        var c = source.charAt(p);
        if (s === S_TAG && c === "<") {
          throw new Error("unexpected < in tag name: " + source.slice(start, p));
        }
        switch (c) {
          case "=":
            if (s === S_ATTR) {
              attrName = source.slice(start, p);
              s = S_EQ;
            } else if (s === S_ATTR_SPACE) {
              s = S_EQ;
            } else {
              throw new Error("attribute equal must after attrName");
            }
            break;
          case "'":
          case '"':
            if (s === S_EQ || s === S_ATTR) {
              if (s === S_ATTR) {
                errorHandler.warning('attribute value must after "="');
                attrName = source.slice(start, p);
              }
              start = p + 1;
              p = source.indexOf(c, start);
              if (p > 0) {
                value = source.slice(start, p);
                addAttribute(attrName, value, start - 1);
                s = S_ATTR_END;
              } else {
                throw new Error("attribute value no end '" + c + "' match");
              }
            } else if (s == S_ATTR_NOQUOT_VALUE) {
              value = source.slice(start, p);
              addAttribute(attrName, value, start);
              errorHandler.warning('attribute "' + attrName + '" missed start quot(' + c + ")!!");
              start = p + 1;
              s = S_ATTR_END;
            } else {
              throw new Error('attribute value must after "="');
            }
            break;
          case "/":
            switch (s) {
              case S_TAG:
                el.setTagName(source.slice(start, p));
              case S_ATTR_END:
              case S_TAG_SPACE:
              case S_TAG_CLOSE:
                s = S_TAG_CLOSE;
                el.closed = true;
              case S_ATTR_NOQUOT_VALUE:
              case S_ATTR:
                break;
              case S_ATTR_SPACE:
                el.closed = true;
                break;
              //case S_EQ:
              default:
                throw new Error("attribute invalid close char('/')");
            }
            break;
          case "":
            errorHandler.error("unexpected end of input");
            if (s == S_TAG) {
              el.setTagName(source.slice(start, p));
            }
            return p;
          case ">":
            switch (s) {
              case S_TAG:
                el.setTagName(source.slice(start, p));
              case S_ATTR_END:
              case S_TAG_SPACE:
              case S_TAG_CLOSE:
                break;
              //normal
              case S_ATTR_NOQUOT_VALUE:
              //Compatible state
              case S_ATTR:
                value = source.slice(start, p);
                if (value.slice(-1) === "/") {
                  el.closed = true;
                  value = value.slice(0, -1);
                }
              case S_ATTR_SPACE:
                if (s === S_ATTR_SPACE) {
                  value = attrName;
                }
                if (s == S_ATTR_NOQUOT_VALUE) {
                  errorHandler.warning('attribute "' + value + '" missed quot(")!');
                  addAttribute(attrName, value, start);
                } else {
                  if (!NAMESPACE.isHTML(currentNSMap[""]) || !value.match(/^(?:disabled|checked|selected)$/i)) {
                    errorHandler.warning('attribute "' + value + '" missed value!! "' + value + '" instead!!');
                  }
                  addAttribute(value, value, start);
                }
                break;
              case S_EQ:
                throw new Error("attribute value missed!!");
            }
            return p;
          /*xml space '\x20' | #x9 | #xD | #xA; */
          case "\x80":
            c = " ";
          default:
            if (c <= " ") {
              switch (s) {
                case S_TAG:
                  el.setTagName(source.slice(start, p));
                  s = S_TAG_SPACE;
                  break;
                case S_ATTR:
                  attrName = source.slice(start, p);
                  s = S_ATTR_SPACE;
                  break;
                case S_ATTR_NOQUOT_VALUE:
                  var value = source.slice(start, p);
                  errorHandler.warning('attribute "' + value + '" missed quot(")!!');
                  addAttribute(attrName, value, start);
                case S_ATTR_END:
                  s = S_TAG_SPACE;
                  break;
              }
            } else {
              switch (s) {
                //case S_TAG:void();break;
                //case S_ATTR:void();break;
                //case S_ATTR_NOQUOT_VALUE:void();break;
                case S_ATTR_SPACE:
                  var tagName = el.tagName;
                  if (!NAMESPACE.isHTML(currentNSMap[""]) || !attrName.match(/^(?:disabled|checked|selected)$/i)) {
                    errorHandler.warning('attribute "' + attrName + '" missed value!! "' + attrName + '" instead2!!');
                  }
                  addAttribute(attrName, attrName, start);
                  start = p;
                  s = S_ATTR;
                  break;
                case S_ATTR_END:
                  errorHandler.warning('attribute space is required"' + attrName + '"!!');
                case S_TAG_SPACE:
                  s = S_ATTR;
                  start = p;
                  break;
                case S_EQ:
                  s = S_ATTR_NOQUOT_VALUE;
                  start = p;
                  break;
                case S_TAG_CLOSE:
                  throw new Error("elements closed character '/' and '>' must be connected to");
              }
            }
        }
        p++;
      }
    }
    function appendElement(el, domBuilder, currentNSMap) {
      var tagName = el.tagName;
      var localNSMap = null;
      var i = el.length;
      while (i--) {
        var a = el[i];
        var qName = a.qName;
        var value = a.value;
        var nsp = qName.indexOf(":");
        if (nsp > 0) {
          var prefix = a.prefix = qName.slice(0, nsp);
          var localName = qName.slice(nsp + 1);
          var nsPrefix = prefix === "xmlns" && localName;
        } else {
          localName = qName;
          prefix = null;
          nsPrefix = qName === "xmlns" && "";
        }
        a.localName = localName;
        if (nsPrefix !== false) {
          if (localNSMap == null) {
            localNSMap = {};
            currentNSMap = Object.create(currentNSMap);
          }
          currentNSMap[nsPrefix] = localNSMap[nsPrefix] = value;
          a.uri = NAMESPACE.XMLNS;
          domBuilder.startPrefixMapping(nsPrefix, value);
        }
      }
      var i = el.length;
      while (i--) {
        a = el[i];
        var prefix = a.prefix;
        if (prefix) {
          if (prefix === "xml") {
            a.uri = NAMESPACE.XML;
          }
          if (prefix !== "xmlns") {
            a.uri = currentNSMap[prefix || ""];
          }
        }
      }
      var nsp = tagName.indexOf(":");
      if (nsp > 0) {
        prefix = el.prefix = tagName.slice(0, nsp);
        localName = el.localName = tagName.slice(nsp + 1);
      } else {
        prefix = null;
        localName = el.localName = tagName;
      }
      var ns = el.uri = currentNSMap[prefix || ""];
      domBuilder.startElement(ns, localName, tagName, el);
      if (el.closed) {
        domBuilder.endElement(ns, localName, tagName);
        if (localNSMap) {
          for (prefix in localNSMap) {
            if (Object.prototype.hasOwnProperty.call(localNSMap, prefix)) {
              domBuilder.endPrefixMapping(prefix);
            }
          }
        }
      } else {
        el.currentNSMap = currentNSMap;
        el.localNSMap = localNSMap;
        return true;
      }
    }
    function parseHtmlSpecialContent(source, elStartEnd, tagName, entityReplacer, domBuilder) {
      if (/^(?:script|textarea)$/i.test(tagName)) {
        var elEndStart = source.indexOf("</" + tagName + ">", elStartEnd);
        var text = source.substring(elStartEnd + 1, elEndStart);
        if (/[&<]/.test(text)) {
          if (/^script$/i.test(tagName)) {
            domBuilder.characters(text, 0, text.length);
            return elEndStart;
          }
          text = text.replace(/&#?\w+;/g, entityReplacer);
          domBuilder.characters(text, 0, text.length);
          return elEndStart;
        }
      }
      return elStartEnd + 1;
    }
    function fixSelfClosed(source, elStartEnd, tagName, closeMap) {
      var pos = closeMap[tagName];
      if (pos == null) {
        pos = source.lastIndexOf("</" + tagName + ">");
        if (pos < elStartEnd) {
          pos = source.lastIndexOf("</" + tagName);
        }
        closeMap[tagName] = pos;
      }
      return pos < elStartEnd;
    }
    function _copy(source, target) {
      for (var n in source) {
        if (Object.prototype.hasOwnProperty.call(source, n)) {
          target[n] = source[n];
        }
      }
    }
    function parseDCC(source, start, domBuilder, errorHandler) {
      var next = source.charAt(start + 2);
      switch (next) {
        case "-":
          if (source.charAt(start + 3) === "-") {
            var end = source.indexOf("-->", start + 4);
            if (end > start) {
              domBuilder.comment(source, start + 4, end - start - 4);
              return end + 3;
            } else {
              errorHandler.error("Unclosed comment");
              return -1;
            }
          } else {
            return -1;
          }
        default:
          if (source.substr(start + 3, 6) == "CDATA[") {
            var end = source.indexOf("]]>", start + 9);
            domBuilder.startCDATA();
            domBuilder.characters(source, start + 9, end - start - 9);
            domBuilder.endCDATA();
            return end + 3;
          }
          var matchs = split(source, start);
          var len = matchs.length;
          if (len > 1 && /!doctype/i.test(matchs[0][0])) {
            var name = matchs[1][0];
            var pubid = false;
            var sysid = false;
            if (len > 3) {
              if (/^public$/i.test(matchs[2][0])) {
                pubid = matchs[3][0];
                sysid = len > 4 && matchs[4][0];
              } else if (/^system$/i.test(matchs[2][0])) {
                sysid = matchs[3][0];
              }
            }
            var lastMatch = matchs[len - 1];
            domBuilder.startDTD(name, pubid, sysid);
            domBuilder.endDTD();
            return lastMatch.index + lastMatch[0].length;
          }
      }
      return -1;
    }
    function parseInstruction(source, start, domBuilder) {
      var end = source.indexOf("?>", start);
      if (end) {
        var match = source.substring(start, end).match(/^<\?(\S*)\s*([\s\S]*?)$/);
        if (match) {
          var len = match[0].length;
          domBuilder.processingInstruction(match[1], match[2]);
          return end + 2;
        } else {
          return -1;
        }
      }
      return -1;
    }
    function ElementAttributes() {
      this.attributeNames = {};
    }
    ElementAttributes.prototype = {
      setTagName: function(tagName) {
        if (!tagNamePattern.test(tagName)) {
          throw new Error("invalid tagName:" + tagName);
        }
        this.tagName = tagName;
      },
      addValue: function(qName, value, offset) {
        if (!tagNamePattern.test(qName)) {
          throw new Error("invalid attribute:" + qName);
        }
        this.attributeNames[qName] = this.length;
        this[this.length++] = { qName, value, offset };
      },
      length: 0,
      getLocalName: function(i) {
        return this[i].localName;
      },
      getLocator: function(i) {
        return this[i].locator;
      },
      getQName: function(i) {
        return this[i].qName;
      },
      getURI: function(i) {
        return this[i].uri;
      },
      getValue: function(i) {
        return this[i].value;
      }
      //	,getIndex:function(uri, localName)){
      //		if(localName){
      //
      //		}else{
      //			var qName = uri
      //		}
      //	},
      //	getValue:function(){return this.getValue(this.getIndex.apply(this,arguments))},
      //	getType:function(uri,localName){}
      //	getType:function(i){},
    };
    function split(source, start) {
      var match;
      var buf = [];
      var reg = /'[^']+'|"[^"]+"|[^\s<>\/=]+=?|(\/?\s*>|<)/g;
      reg.lastIndex = start;
      reg.exec(source);
      while (match = reg.exec(source)) {
        buf.push(match);
        if (match[1]) return buf;
      }
    }
    exports.XMLReader = XMLReader;
    exports.ParseError = ParseError;
  }
});

// work/browser-build/node_modules/@xmldom/xmldom/lib/dom-parser.js
var require_dom_parser = __commonJS({
  "work/browser-build/node_modules/@xmldom/xmldom/lib/dom-parser.js"(exports) {
    var conventions = require_conventions();
    var dom = require_dom();
    var entities = require_entities();
    var sax = require_sax();
    var DOMImplementation = dom.DOMImplementation;
    var NAMESPACE = conventions.NAMESPACE;
    var ParseError = sax.ParseError;
    var XMLReader = sax.XMLReader;
    function normalizeLineEndings(input) {
      return input.replace(/\r[\n\u0085]/g, "\n").replace(/[\r\u0085\u2028]/g, "\n");
    }
    function DOMParser2(options) {
      this.options = options || { locator: {} };
    }
    DOMParser2.prototype.parseFromString = function(source, mimeType) {
      var options = this.options;
      var sax2 = new XMLReader();
      var domBuilder = options.domBuilder || new DOMHandler();
      var errorHandler = options.errorHandler;
      var locator = options.locator;
      var defaultNSMap = options.xmlns || {};
      var isHTML = /\/x?html?$/.test(mimeType);
      var entityMap = isHTML ? entities.HTML_ENTITIES : entities.XML_ENTITIES;
      if (locator) {
        domBuilder.setDocumentLocator(locator);
      }
      sax2.errorHandler = buildErrorHandler(errorHandler, domBuilder, locator);
      sax2.domBuilder = options.domBuilder || domBuilder;
      if (isHTML) {
        defaultNSMap[""] = NAMESPACE.HTML;
      }
      defaultNSMap.xml = defaultNSMap.xml || NAMESPACE.XML;
      var normalize = options.normalizeLineEndings || normalizeLineEndings;
      if (source && typeof source === "string") {
        sax2.parse(
          normalize(source),
          defaultNSMap,
          entityMap
        );
      } else {
        sax2.errorHandler.error("invalid doc source");
      }
      return domBuilder.doc;
    };
    function buildErrorHandler(errorImpl, domBuilder, locator) {
      if (!errorImpl) {
        if (domBuilder instanceof DOMHandler) {
          return domBuilder;
        }
        errorImpl = domBuilder;
      }
      var errorHandler = {};
      var isCallback = errorImpl instanceof Function;
      locator = locator || {};
      function build(key) {
        var fn = errorImpl[key];
        if (!fn && isCallback) {
          fn = errorImpl.length == 2 ? function(msg) {
            errorImpl(key, msg);
          } : errorImpl;
        }
        errorHandler[key] = fn && function(msg) {
          fn("[xmldom " + key + "]	" + msg + _locator(locator));
        } || function() {
        };
      }
      build("warning");
      build("error");
      build("fatalError");
      return errorHandler;
    }
    function DOMHandler() {
      this.cdata = false;
    }
    function position(locator, node) {
      node.lineNumber = locator.lineNumber;
      node.columnNumber = locator.columnNumber;
    }
    DOMHandler.prototype = {
      startDocument: function() {
        this.doc = new DOMImplementation().createDocument(null, null, null);
        if (this.locator) {
          this.doc.documentURI = this.locator.systemId;
        }
      },
      startElement: function(namespaceURI, localName, qName, attrs) {
        var doc = this.doc;
        var el = doc.createElementNS(namespaceURI, qName || localName);
        var len = attrs.length;
        appendElement(this, el);
        this.currentElement = el;
        this.locator && position(this.locator, el);
        for (var i = 0; i < len; i++) {
          var namespaceURI = attrs.getURI(i);
          var value = attrs.getValue(i);
          var qName = attrs.getQName(i);
          var attr = doc.createAttributeNS(namespaceURI, qName);
          this.locator && position(attrs.getLocator(i), attr);
          attr.value = attr.nodeValue = value;
          el.setAttributeNode(attr);
        }
      },
      endElement: function(namespaceURI, localName, qName) {
        var current = this.currentElement;
        var tagName = current.tagName;
        this.currentElement = current.parentNode;
      },
      startPrefixMapping: function(prefix, uri) {
      },
      endPrefixMapping: function(prefix) {
      },
      processingInstruction: function(target, data) {
        var ins = this.doc.createProcessingInstruction(target, data);
        this.locator && position(this.locator, ins);
        appendElement(this, ins);
      },
      ignorableWhitespace: function(ch, start, length) {
      },
      characters: function(chars, start, length) {
        chars = _toString.apply(this, arguments);
        if (chars) {
          if (this.cdata) {
            var charNode = this.doc.createCDATASection(chars);
          } else {
            var charNode = this.doc.createTextNode(chars);
          }
          if (this.currentElement) {
            this.currentElement.appendChild(charNode);
          } else if (/^\s*$/.test(chars)) {
            this.doc.appendChild(charNode);
          }
          this.locator && position(this.locator, charNode);
        }
      },
      skippedEntity: function(name) {
      },
      endDocument: function() {
        this.doc.normalize();
      },
      setDocumentLocator: function(locator) {
        if (this.locator = locator) {
          locator.lineNumber = 0;
        }
      },
      //LexicalHandler
      comment: function(chars, start, length) {
        chars = _toString.apply(this, arguments);
        var comm = this.doc.createComment(chars);
        this.locator && position(this.locator, comm);
        appendElement(this, comm);
      },
      startCDATA: function() {
        this.cdata = true;
      },
      endCDATA: function() {
        this.cdata = false;
      },
      startDTD: function(name, publicId, systemId) {
        var impl = this.doc.implementation;
        if (impl && impl.createDocumentType) {
          var dt = impl.createDocumentType(name, publicId, systemId);
          this.locator && position(this.locator, dt);
          appendElement(this, dt);
          this.doc.doctype = dt;
        }
      },
      /**
       * @see org.xml.sax.ErrorHandler
       * @link http://www.saxproject.org/apidoc/org/xml/sax/ErrorHandler.html
       */
      warning: function(error) {
        console.warn("[xmldom warning]	" + error, _locator(this.locator));
      },
      error: function(error) {
        console.error("[xmldom error]	" + error, _locator(this.locator));
      },
      fatalError: function(error) {
        throw new ParseError(error, this.locator);
      }
    };
    function _locator(l) {
      if (l) {
        return "\n@" + (l.systemId || "") + "#[line:" + l.lineNumber + ",col:" + l.columnNumber + "]";
      }
    }
    function _toString(chars, start, length) {
      if (typeof chars == "string") {
        return chars.substr(start, length);
      } else {
        if (chars.length >= start + length || start) {
          return new java.lang.String(chars, start, length) + "";
        }
        return chars;
      }
    }
    "endDTD,startEntity,endEntity,attributeDecl,elementDecl,externalEntityDecl,internalEntityDecl,resolveEntity,getExternalSubset,notationDecl,unparsedEntityDecl".replace(/\w+/g, function(key) {
      DOMHandler.prototype[key] = function() {
        return null;
      };
    });
    function appendElement(hander, node) {
      if (!hander.currentElement) {
        hander.doc.appendChild(node);
      } else {
        hander.currentElement.appendChild(node);
      }
    }
    exports.__DOMHandler = DOMHandler;
    exports.normalizeLineEndings = normalizeLineEndings;
    exports.DOMParser = DOMParser2;
  }
});

// work/browser-build/node_modules/@xmldom/xmldom/lib/index.js
var require_lib = __commonJS({
  "work/browser-build/node_modules/@xmldom/xmldom/lib/index.js"(exports) {
    var dom = require_dom();
    exports.DOMImplementation = dom.DOMImplementation;
    exports.XMLSerializer = dom.XMLSerializer;
    exports.DOMParser = require_dom_parser().DOMParser;
  }
});

// work/browser-build/node_modules/@videojs/vhs-utils/es/stream.js
var Stream = /* @__PURE__ */ (function() {
  function Stream2() {
    this.listeners = {};
  }
  var _proto = Stream2.prototype;
  _proto.on = function on(type, listener) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  };
  _proto.off = function off(type, listener) {
    if (!this.listeners[type]) {
      return false;
    }
    var index = this.listeners[type].indexOf(listener);
    this.listeners[type] = this.listeners[type].slice(0);
    this.listeners[type].splice(index, 1);
    return index > -1;
  };
  _proto.trigger = function trigger(type) {
    var callbacks = this.listeners[type];
    if (!callbacks) {
      return;
    }
    if (arguments.length === 2) {
      var length = callbacks.length;
      for (var i = 0; i < length; ++i) {
        callbacks[i].call(this, arguments[1]);
      }
    } else {
      var args = Array.prototype.slice.call(arguments, 1);
      var _length = callbacks.length;
      for (var _i = 0; _i < _length; ++_i) {
        callbacks[_i].apply(this, args);
      }
    }
  };
  _proto.dispose = function dispose() {
    this.listeners = {};
  };
  _proto.pipe = function pipe(destination) {
    this.on("data", function(data) {
      destination.push(data);
    });
  };
  return Stream2;
})();

// work/browser-build/node_modules/@babel/runtime/helpers/esm/extends.js
function _extends() {
  return _extends = Object.assign ? Object.assign.bind() : function(n) {
    for (var e = 1; e < arguments.length; e++) {
      var t = arguments[e];
      for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]);
    }
    return n;
  }, _extends.apply(null, arguments);
}

// work/browser-build/node_modules/@videojs/vhs-utils/es/decode-b64-to-uint8-array.js
var import_window = __toESM(require_window());
var atob = function atob2(s) {
  return import_window.default.atob ? import_window.default.atob(s) : Buffer.from(s, "base64").toString("binary");
};
function decodeB64ToUint8Array(b64Text) {
  var decodedString = atob(b64Text);
  var array = new Uint8Array(decodedString.length);
  for (var i = 0; i < decodedString.length; i++) {
    array[i] = decodedString.charCodeAt(i);
  }
  return array;
}

// work/browser-build/node_modules/m3u8-parser/dist/m3u8-parser.es.js
var LineStream = class extends Stream {
  constructor() {
    super();
    this.buffer = "";
  }
  /**
   * Add new data to be parsed.
   *
   * @param {string} data the text to process
   */
  push(data) {
    let nextNewline;
    this.buffer += data;
    nextNewline = this.buffer.indexOf("\n");
    for (; nextNewline > -1; nextNewline = this.buffer.indexOf("\n")) {
      this.trigger("data", this.buffer.substring(0, nextNewline));
      this.buffer = this.buffer.substring(nextNewline + 1);
    }
  }
};
var TAB = String.fromCharCode(9);
var parseByterange = function(byterangeString) {
  const match = /([0-9.]*)?@?([0-9.]*)?/.exec(byterangeString || "");
  const result = {};
  if (match[1]) {
    result.length = parseInt(match[1], 10);
  }
  if (match[2]) {
    result.offset = parseInt(match[2], 10);
  }
  return result;
};
var attributeSeparator = function() {
  const key = "[^=]*";
  const value = '"[^"]*"|[^,]*';
  const keyvalue = "(?:" + key + ")=(?:" + value + ")";
  return new RegExp("(?:^|,)(" + keyvalue + ")");
};
var parseAttributes = function(attributes) {
  const result = {};
  if (!attributes) {
    return result;
  }
  const attrs = attributes.split(attributeSeparator());
  let i = attrs.length;
  let attr;
  while (i--) {
    if (attrs[i] === "") {
      continue;
    }
    attr = /([^=]*)=(.*)/.exec(attrs[i]).slice(1);
    attr[0] = attr[0].replace(/^\s+|\s+$/g, "");
    attr[1] = attr[1].replace(/^\s+|\s+$/g, "");
    attr[1] = attr[1].replace(/^['"](.*)['"]$/g, "$1");
    result[attr[0]] = attr[1];
  }
  return result;
};
var parseResolution = (resolution) => {
  const split = resolution.split("x");
  const result = {};
  if (split[0]) {
    result.width = parseInt(split[0], 10);
  }
  if (split[1]) {
    result.height = parseInt(split[1], 10);
  }
  return result;
};
var ParseStream = class extends Stream {
  constructor() {
    super();
    this.customParsers = [];
    this.tagMappers = [];
  }
  /**
   * Parses an additional line of input.
   *
   * @param {string} line a single line of an M3U8 file to parse
   */
  push(line) {
    let match;
    let event;
    line = line.trim();
    if (line.length === 0) {
      return;
    }
    if (line[0] !== "#") {
      this.trigger("data", {
        type: "uri",
        uri: line
      });
      return;
    }
    const newLines = this.tagMappers.reduce((acc, mapper) => {
      const mappedLine = mapper(line);
      if (mappedLine === line) {
        return acc;
      }
      return acc.concat([mappedLine]);
    }, [line]);
    newLines.forEach((newLine) => {
      for (let i = 0; i < this.customParsers.length; i++) {
        if (this.customParsers[i].call(this, newLine)) {
          return;
        }
      }
      if (newLine.indexOf("#EXT") !== 0) {
        this.trigger("data", {
          type: "comment",
          text: newLine.slice(1)
        });
        return;
      }
      newLine = newLine.replace("\r", "");
      match = /^#EXTM3U/.exec(newLine);
      if (match) {
        this.trigger("data", {
          type: "tag",
          tagType: "m3u"
        });
        return;
      }
      match = /^#EXTINF:([0-9\.]*)?,?(.*)?$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "inf"
        };
        if (match[1]) {
          event.duration = parseFloat(match[1]);
        }
        if (match[2]) {
          event.title = match[2];
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-TARGETDURATION:([0-9.]*)?/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "targetduration"
        };
        if (match[1]) {
          event.duration = parseInt(match[1], 10);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-VERSION:([0-9.]*)?/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "version"
        };
        if (match[1]) {
          event.version = parseInt(match[1], 10);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-MEDIA-SEQUENCE:(\-?[0-9.]*)?/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "media-sequence"
        };
        if (match[1]) {
          event.number = parseInt(match[1], 10);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-DISCONTINUITY-SEQUENCE:(\-?[0-9.]*)?/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "discontinuity-sequence"
        };
        if (match[1]) {
          event.number = parseInt(match[1], 10);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-PLAYLIST-TYPE:(.*)?$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "playlist-type"
        };
        if (match[1]) {
          event.playlistType = match[1];
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-BYTERANGE:(.*)?$/.exec(newLine);
      if (match) {
        event = _extends(parseByterange(match[1]), {
          type: "tag",
          tagType: "byterange"
        });
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-ALLOW-CACHE:(YES|NO)?/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "allow-cache"
        };
        if (match[1]) {
          event.allowed = !/NO/.test(match[1]);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-MAP:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "map"
        };
        if (match[1]) {
          const attributes = parseAttributes(match[1]);
          if (attributes.URI) {
            event.uri = attributes.URI;
          }
          if (attributes.BYTERANGE) {
            event.byterange = parseByterange(attributes.BYTERANGE);
          }
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-STREAM-INF:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "stream-inf"
        };
        if (match[1]) {
          event.attributes = parseAttributes(match[1]);
          if (event.attributes.RESOLUTION) {
            event.attributes.RESOLUTION = parseResolution(event.attributes.RESOLUTION);
          }
          if (event.attributes.BANDWIDTH) {
            event.attributes.BANDWIDTH = parseInt(event.attributes.BANDWIDTH, 10);
          }
          if (event.attributes["FRAME-RATE"]) {
            event.attributes["FRAME-RATE"] = parseFloat(event.attributes["FRAME-RATE"]);
          }
          if (event.attributes["PROGRAM-ID"]) {
            event.attributes["PROGRAM-ID"] = parseInt(event.attributes["PROGRAM-ID"], 10);
          }
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-MEDIA:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "media"
        };
        if (match[1]) {
          event.attributes = parseAttributes(match[1]);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-ENDLIST/.exec(newLine);
      if (match) {
        this.trigger("data", {
          type: "tag",
          tagType: "endlist"
        });
        return;
      }
      match = /^#EXT-X-DISCONTINUITY/.exec(newLine);
      if (match) {
        this.trigger("data", {
          type: "tag",
          tagType: "discontinuity"
        });
        return;
      }
      match = /^#EXT-X-PROGRAM-DATE-TIME:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "program-date-time"
        };
        if (match[1]) {
          event.dateTimeString = match[1];
          event.dateTimeObject = new Date(match[1]);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-KEY:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "key"
        };
        if (match[1]) {
          event.attributes = parseAttributes(match[1]);
          if (event.attributes.IV) {
            if (event.attributes.IV.substring(0, 2).toLowerCase() === "0x") {
              event.attributes.IV = event.attributes.IV.substring(2);
            }
            event.attributes.IV = event.attributes.IV.match(/.{8}/g);
            event.attributes.IV[0] = parseInt(event.attributes.IV[0], 16);
            event.attributes.IV[1] = parseInt(event.attributes.IV[1], 16);
            event.attributes.IV[2] = parseInt(event.attributes.IV[2], 16);
            event.attributes.IV[3] = parseInt(event.attributes.IV[3], 16);
            event.attributes.IV = new Uint32Array(event.attributes.IV);
          }
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-START:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "start"
        };
        if (match[1]) {
          event.attributes = parseAttributes(match[1]);
          event.attributes["TIME-OFFSET"] = parseFloat(event.attributes["TIME-OFFSET"]);
          event.attributes.PRECISE = /YES/.test(event.attributes.PRECISE);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-CUE-OUT-CONT:(.*)?$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "cue-out-cont"
        };
        if (match[1]) {
          event.data = match[1];
        } else {
          event.data = "";
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-CUE-OUT:(.*)?$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "cue-out"
        };
        if (match[1]) {
          event.data = match[1];
        } else {
          event.data = "";
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-CUE-IN:?(.*)?$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "cue-in"
        };
        if (match[1]) {
          event.data = match[1];
        } else {
          event.data = "";
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-SKIP:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "skip"
        };
        event.attributes = parseAttributes(match[1]);
        if (event.attributes.hasOwnProperty("SKIPPED-SEGMENTS")) {
          event.attributes["SKIPPED-SEGMENTS"] = parseInt(event.attributes["SKIPPED-SEGMENTS"], 10);
        }
        if (event.attributes.hasOwnProperty("RECENTLY-REMOVED-DATERANGES")) {
          event.attributes["RECENTLY-REMOVED-DATERANGES"] = event.attributes["RECENTLY-REMOVED-DATERANGES"].split(TAB);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-PART:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "part"
        };
        event.attributes = parseAttributes(match[1]);
        ["DURATION"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = parseFloat(event.attributes[key]);
          }
        });
        ["INDEPENDENT", "GAP"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = /YES/.test(event.attributes[key]);
          }
        });
        if (event.attributes.hasOwnProperty("BYTERANGE")) {
          event.attributes.byterange = parseByterange(event.attributes.BYTERANGE);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-SERVER-CONTROL:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "server-control"
        };
        event.attributes = parseAttributes(match[1]);
        ["CAN-SKIP-UNTIL", "PART-HOLD-BACK", "HOLD-BACK"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = parseFloat(event.attributes[key]);
          }
        });
        ["CAN-SKIP-DATERANGES", "CAN-BLOCK-RELOAD"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = /YES/.test(event.attributes[key]);
          }
        });
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-PART-INF:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "part-inf"
        };
        event.attributes = parseAttributes(match[1]);
        ["PART-TARGET"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = parseFloat(event.attributes[key]);
          }
        });
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-PRELOAD-HINT:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "preload-hint"
        };
        event.attributes = parseAttributes(match[1]);
        ["BYTERANGE-START", "BYTERANGE-LENGTH"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = parseInt(event.attributes[key], 10);
            const subkey = key === "BYTERANGE-LENGTH" ? "length" : "offset";
            event.attributes.byterange = event.attributes.byterange || {};
            event.attributes.byterange[subkey] = event.attributes[key];
            delete event.attributes[key];
          }
        });
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-RENDITION-REPORT:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "rendition-report"
        };
        event.attributes = parseAttributes(match[1]);
        ["LAST-MSN", "LAST-PART"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = parseInt(event.attributes[key], 10);
          }
        });
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-DATERANGE:(.*)$/.exec(newLine);
      if (match && match[1]) {
        event = {
          type: "tag",
          tagType: "daterange"
        };
        event.attributes = parseAttributes(match[1]);
        ["ID", "CLASS"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = String(event.attributes[key]);
          }
        });
        ["START-DATE", "END-DATE"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = new Date(event.attributes[key]);
          }
        });
        ["DURATION", "PLANNED-DURATION"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = parseFloat(event.attributes[key]);
          }
        });
        ["END-ON-NEXT"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = /YES/i.test(event.attributes[key]);
          }
        });
        ["SCTE35-CMD", " SCTE35-OUT", "SCTE35-IN"].forEach(function(key) {
          if (event.attributes.hasOwnProperty(key)) {
            event.attributes[key] = event.attributes[key].toString(16);
          }
        });
        const clientAttributePattern = /^X-([A-Z]+-)+[A-Z]+$/;
        for (const key in event.attributes) {
          if (!clientAttributePattern.test(key)) {
            continue;
          }
          const isHexaDecimal = /[0-9A-Fa-f]{6}/g.test(event.attributes[key]);
          const isDecimalFloating = /^\d+(\.\d+)?$/.test(event.attributes[key]);
          event.attributes[key] = isHexaDecimal ? event.attributes[key].toString(16) : isDecimalFloating ? parseFloat(event.attributes[key]) : String(event.attributes[key]);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-INDEPENDENT-SEGMENTS/.exec(newLine);
      if (match) {
        this.trigger("data", {
          type: "tag",
          tagType: "independent-segments"
        });
        return;
      }
      match = /^#EXT-X-I-FRAMES-ONLY/.exec(newLine);
      if (match) {
        this.trigger("data", {
          type: "tag",
          tagType: "i-frames-only"
        });
        return;
      }
      match = /^#EXT-X-CONTENT-STEERING:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "content-steering"
        };
        event.attributes = parseAttributes(match[1]);
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-I-FRAME-STREAM-INF:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "i-frame-playlist"
        };
        event.attributes = parseAttributes(match[1]);
        if (event.attributes.URI) {
          event.uri = event.attributes.URI;
        }
        if (event.attributes.BANDWIDTH) {
          event.attributes.BANDWIDTH = parseInt(event.attributes.BANDWIDTH, 10);
        }
        if (event.attributes.RESOLUTION) {
          event.attributes.RESOLUTION = parseResolution(event.attributes.RESOLUTION);
        }
        if (event.attributes["AVERAGE-BANDWIDTH"]) {
          event.attributes["AVERAGE-BANDWIDTH"] = parseInt(event.attributes["AVERAGE-BANDWIDTH"], 10);
        }
        if (event.attributes["FRAME-RATE"]) {
          event.attributes["FRAME-RATE"] = parseFloat(event.attributes["FRAME-RATE"]);
        }
        this.trigger("data", event);
        return;
      }
      match = /^#EXT-X-DEFINE:(.*)$/.exec(newLine);
      if (match) {
        event = {
          type: "tag",
          tagType: "define"
        };
        event.attributes = parseAttributes(match[1]);
        this.trigger("data", event);
        return;
      }
      this.trigger("data", {
        type: "tag",
        data: newLine.slice(4)
      });
    });
  }
  /**
   * Add a parser for custom headers
   *
   * @param {Object}   options              a map of options for the added parser
   * @param {RegExp}   options.expression   a regular expression to match the custom header
   * @param {string}   options.customType   the custom type to register to the output
   * @param {Function} [options.dataParser] function to parse the line into an object
   * @param {boolean}  [options.segment]    should tag data be attached to the segment object
   */
  addParser({
    expression,
    customType,
    dataParser,
    segment
  }) {
    if (typeof dataParser !== "function") {
      dataParser = (line) => line;
    }
    this.customParsers.push((line) => {
      const match = expression.exec(line);
      if (match) {
        this.trigger("data", {
          type: "custom",
          data: dataParser(line),
          customType,
          segment
        });
        return true;
      }
    });
  }
  /**
   * Add a custom header mapper
   *
   * @param {Object}   options
   * @param {RegExp}   options.expression   a regular expression to match the custom header
   * @param {Function} options.map          function to translate tag into a different tag
   */
  addTagMapper({
    expression,
    map
  }) {
    const mapFn = (line) => {
      if (expression.test(line)) {
        return map(line);
      }
      return line;
    };
    this.tagMappers.push(mapFn);
  }
};
var camelCase = (str) => str.toLowerCase().replace(/-(\w)/g, (a) => a[1].toUpperCase());
var camelCaseKeys = function(attributes) {
  const result = {};
  Object.keys(attributes).forEach(function(key) {
    result[camelCase(key)] = attributes[key];
  });
  return result;
};
var setHoldBack = function(manifest) {
  const {
    serverControl,
    targetDuration,
    partTargetDuration
  } = manifest;
  if (!serverControl) {
    return;
  }
  const tag = "#EXT-X-SERVER-CONTROL";
  const hb = "holdBack";
  const phb = "partHoldBack";
  const minTargetDuration = targetDuration && targetDuration * 3;
  const minPartDuration = partTargetDuration && partTargetDuration * 2;
  if (targetDuration && !serverControl.hasOwnProperty(hb)) {
    serverControl[hb] = minTargetDuration;
    this.trigger("info", {
      message: `${tag} defaulting HOLD-BACK to targetDuration * 3 (${minTargetDuration}).`
    });
  }
  if (minTargetDuration && serverControl[hb] < minTargetDuration) {
    this.trigger("warn", {
      message: `${tag} clamping HOLD-BACK (${serverControl[hb]}) to targetDuration * 3 (${minTargetDuration})`
    });
    serverControl[hb] = minTargetDuration;
  }
  if (partTargetDuration && !serverControl.hasOwnProperty(phb)) {
    serverControl[phb] = partTargetDuration * 3;
    this.trigger("info", {
      message: `${tag} defaulting PART-HOLD-BACK to partTargetDuration * 3 (${serverControl[phb]}).`
    });
  }
  if (partTargetDuration && serverControl[phb] < minPartDuration) {
    this.trigger("warn", {
      message: `${tag} clamping PART-HOLD-BACK (${serverControl[phb]}) to partTargetDuration * 2 (${minPartDuration}).`
    });
    serverControl[phb] = minPartDuration;
  }
};
var Parser = class extends Stream {
  constructor(opts = {}) {
    super();
    this.lineStream = new LineStream();
    this.parseStream = new ParseStream();
    this.lineStream.pipe(this.parseStream);
    this.mainDefinitions = opts.mainDefinitions || {};
    this.params = new URL(opts.uri, "https://a.com").searchParams;
    this.lastProgramDateTime = null;
    const self2 = this;
    const uris = [];
    let currentUri = {};
    let currentMap;
    let key;
    let hasParts = false;
    const noop = function() {
    };
    const defaultMediaGroups = {
      "AUDIO": {},
      "VIDEO": {},
      "CLOSED-CAPTIONS": {},
      "SUBTITLES": {}
    };
    const widevineUuid = "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed";
    let currentTimeline = 0;
    this.manifest = {
      allowCache: true,
      discontinuityStarts: [],
      dateRanges: [],
      iFramePlaylists: [],
      segments: []
    };
    let lastByterangeEnd = 0;
    let lastPartByterangeEnd = 0;
    const dateRangeTags = {};
    this.on("end", () => {
      if (currentUri.uri || !currentUri.parts && !currentUri.preloadHints) {
        return;
      }
      if (!currentUri.map && currentMap) {
        currentUri.map = currentMap;
      }
      if (!currentUri.key && key) {
        currentUri.key = key;
      }
      if (!currentUri.timeline && typeof currentTimeline === "number") {
        currentUri.timeline = currentTimeline;
      }
      this.manifest.preloadSegment = currentUri;
    });
    this.parseStream.on("data", function(entry) {
      let mediaGroup;
      let rendition;
      if (self2.manifest.definitions) {
        for (const def in self2.manifest.definitions) {
          if (entry.uri) {
            entry.uri = entry.uri.replace(`{$${def}}`, self2.manifest.definitions[def]);
          }
          if (entry.attributes) {
            for (const attr in entry.attributes) {
              if (typeof entry.attributes[attr] === "string") {
                entry.attributes[attr] = entry.attributes[attr].replace(`{$${def}}`, self2.manifest.definitions[def]);
              }
            }
          }
        }
      }
      ({
        tag() {
          ({
            version() {
              if (entry.version) {
                this.manifest.version = entry.version;
              }
            },
            "allow-cache"() {
              this.manifest.allowCache = entry.allowed;
              if (!("allowed" in entry)) {
                this.trigger("info", {
                  message: "defaulting allowCache to YES"
                });
                this.manifest.allowCache = true;
              }
            },
            byterange() {
              const byterange = {};
              if ("length" in entry) {
                currentUri.byterange = byterange;
                byterange.length = entry.length;
                if (!("offset" in entry)) {
                  entry.offset = lastByterangeEnd;
                }
              }
              if ("offset" in entry) {
                currentUri.byterange = byterange;
                byterange.offset = entry.offset;
              }
              lastByterangeEnd = byterange.offset + byterange.length;
            },
            endlist() {
              this.manifest.endList = true;
            },
            inf() {
              if (!("mediaSequence" in this.manifest)) {
                this.manifest.mediaSequence = 0;
                this.trigger("info", {
                  message: "defaulting media sequence to zero"
                });
              }
              if (!("discontinuitySequence" in this.manifest)) {
                this.manifest.discontinuitySequence = 0;
                this.trigger("info", {
                  message: "defaulting discontinuity sequence to zero"
                });
              }
              if (entry.title) {
                currentUri.title = entry.title;
              }
              if (entry.duration > 0) {
                currentUri.duration = entry.duration;
              }
              if (entry.duration === 0) {
                currentUri.duration = 0.01;
                this.trigger("info", {
                  message: "updating zero segment duration to a small value"
                });
              }
              this.manifest.segments = uris;
            },
            key() {
              if (!entry.attributes) {
                this.trigger("warn", {
                  message: "ignoring key declaration without attribute list"
                });
                return;
              }
              if (entry.attributes.METHOD === "NONE") {
                key = null;
                return;
              }
              if (!entry.attributes.URI) {
                this.trigger("warn", {
                  message: "ignoring key declaration without URI"
                });
                return;
              }
              if (entry.attributes.KEYFORMAT === "com.apple.streamingkeydelivery") {
                this.manifest.contentProtection = this.manifest.contentProtection || {};
                this.manifest.contentProtection["com.apple.fps.1_0"] = {
                  attributes: entry.attributes
                };
                return;
              }
              if (entry.attributes.KEYFORMAT === "com.microsoft.playready") {
                this.manifest.contentProtection = this.manifest.contentProtection || {};
                this.manifest.contentProtection["com.microsoft.playready"] = {
                  uri: entry.attributes.URI
                };
                return;
              }
              if (entry.attributes.KEYFORMAT === widevineUuid) {
                const VALID_METHODS = ["SAMPLE-AES", "SAMPLE-AES-CTR", "SAMPLE-AES-CENC"];
                if (VALID_METHODS.indexOf(entry.attributes.METHOD) === -1) {
                  this.trigger("warn", {
                    message: "invalid key method provided for Widevine"
                  });
                  return;
                }
                if (entry.attributes.METHOD === "SAMPLE-AES-CENC") {
                  this.trigger("warn", {
                    message: "SAMPLE-AES-CENC is deprecated, please use SAMPLE-AES-CTR instead"
                  });
                }
                if (entry.attributes.URI.substring(0, 23) !== "data:text/plain;base64,") {
                  this.trigger("warn", {
                    message: "invalid key URI provided for Widevine"
                  });
                  return;
                }
                if (!(entry.attributes.KEYID && entry.attributes.KEYID.substring(0, 2) === "0x")) {
                  this.trigger("warn", {
                    message: "invalid key ID provided for Widevine"
                  });
                  return;
                }
                this.manifest.contentProtection = this.manifest.contentProtection || {};
                this.manifest.contentProtection["com.widevine.alpha"] = {
                  attributes: {
                    schemeIdUri: entry.attributes.KEYFORMAT,
                    // remove '0x' from the key id string
                    keyId: entry.attributes.KEYID.substring(2)
                  },
                  // decode the base64-encoded PSSH box
                  pssh: decodeB64ToUint8Array(entry.attributes.URI.split(",")[1])
                };
                return;
              }
              if (!entry.attributes.METHOD) {
                this.trigger("warn", {
                  message: "defaulting key method to AES-128"
                });
              }
              key = {
                method: entry.attributes.METHOD || "AES-128",
                uri: entry.attributes.URI
              };
              if (typeof entry.attributes.IV !== "undefined") {
                key.iv = entry.attributes.IV;
              }
            },
            "media-sequence"() {
              if (!isFinite(entry.number)) {
                this.trigger("warn", {
                  message: "ignoring invalid media sequence: " + entry.number
                });
                return;
              }
              this.manifest.mediaSequence = entry.number;
            },
            "discontinuity-sequence"() {
              if (!isFinite(entry.number)) {
                this.trigger("warn", {
                  message: "ignoring invalid discontinuity sequence: " + entry.number
                });
                return;
              }
              this.manifest.discontinuitySequence = entry.number;
              currentTimeline = entry.number;
            },
            "playlist-type"() {
              if (!/VOD|EVENT/.test(entry.playlistType)) {
                this.trigger("warn", {
                  message: "ignoring unknown playlist type: " + entry.playlist
                });
                return;
              }
              this.manifest.playlistType = entry.playlistType;
            },
            map() {
              currentMap = {};
              if (entry.uri) {
                currentMap.uri = entry.uri;
              }
              if (entry.byterange) {
                currentMap.byterange = entry.byterange;
              }
              if (key) {
                currentMap.key = key;
              }
            },
            "stream-inf"() {
              this.manifest.playlists = uris;
              this.manifest.mediaGroups = this.manifest.mediaGroups || defaultMediaGroups;
              if (!entry.attributes) {
                this.trigger("warn", {
                  message: "ignoring empty stream-inf attributes"
                });
                return;
              }
              if (!currentUri.attributes) {
                currentUri.attributes = {};
              }
              _extends(currentUri.attributes, entry.attributes);
            },
            media() {
              this.manifest.mediaGroups = this.manifest.mediaGroups || defaultMediaGroups;
              if (!(entry.attributes && entry.attributes.TYPE && entry.attributes["GROUP-ID"] && entry.attributes.NAME)) {
                this.trigger("warn", {
                  message: "ignoring incomplete or missing media group"
                });
                return;
              }
              const mediaGroupType = this.manifest.mediaGroups[entry.attributes.TYPE];
              mediaGroupType[entry.attributes["GROUP-ID"]] = mediaGroupType[entry.attributes["GROUP-ID"]] || {};
              mediaGroup = mediaGroupType[entry.attributes["GROUP-ID"]];
              rendition = {
                default: /yes/i.test(entry.attributes.DEFAULT)
              };
              if (rendition.default) {
                rendition.autoselect = true;
              } else {
                rendition.autoselect = /yes/i.test(entry.attributes.AUTOSELECT);
              }
              if (entry.attributes.LANGUAGE) {
                rendition.language = entry.attributes.LANGUAGE;
              }
              if (entry.attributes.URI) {
                rendition.uri = entry.attributes.URI;
              }
              if (entry.attributes["INSTREAM-ID"]) {
                rendition.instreamId = entry.attributes["INSTREAM-ID"];
              }
              if (entry.attributes.CHARACTERISTICS) {
                rendition.characteristics = entry.attributes.CHARACTERISTICS;
              }
              if (entry.attributes.FORCED) {
                rendition.forced = /yes/i.test(entry.attributes.FORCED);
              }
              mediaGroup[entry.attributes.NAME] = rendition;
            },
            discontinuity() {
              currentTimeline += 1;
              currentUri.discontinuity = true;
              this.manifest.discontinuityStarts.push(uris.length);
            },
            "program-date-time"() {
              if (typeof this.manifest.dateTimeString === "undefined") {
                this.manifest.dateTimeString = entry.dateTimeString;
                this.manifest.dateTimeObject = entry.dateTimeObject;
              }
              currentUri.dateTimeString = entry.dateTimeString;
              currentUri.dateTimeObject = entry.dateTimeObject;
              const {
                lastProgramDateTime
              } = this;
              this.lastProgramDateTime = new Date(entry.dateTimeString).getTime();
              if (lastProgramDateTime === null) {
                this.manifest.segments.reduceRight((programDateTime, segment) => {
                  segment.programDateTime = programDateTime - segment.duration * 1e3;
                  return segment.programDateTime;
                }, this.lastProgramDateTime);
              }
            },
            targetduration() {
              if (!isFinite(entry.duration) || entry.duration < 0) {
                this.trigger("warn", {
                  message: "ignoring invalid target duration: " + entry.duration
                });
                return;
              }
              this.manifest.targetDuration = entry.duration;
              setHoldBack.call(this, this.manifest);
            },
            start() {
              if (!entry.attributes || isNaN(entry.attributes["TIME-OFFSET"])) {
                this.trigger("warn", {
                  message: "ignoring start declaration without appropriate attribute list"
                });
                return;
              }
              this.manifest.start = {
                timeOffset: entry.attributes["TIME-OFFSET"],
                precise: entry.attributes.PRECISE
              };
            },
            "cue-out"() {
              currentUri.cueOut = entry.data;
            },
            "cue-out-cont"() {
              currentUri.cueOutCont = entry.data;
            },
            "cue-in"() {
              currentUri.cueIn = entry.data;
            },
            "skip"() {
              this.manifest.skip = camelCaseKeys(entry.attributes);
              this.warnOnMissingAttributes_("#EXT-X-SKIP", entry.attributes, ["SKIPPED-SEGMENTS"]);
            },
            "part"() {
              hasParts = true;
              const segmentIndex = this.manifest.segments.length;
              const part = camelCaseKeys(entry.attributes);
              currentUri.parts = currentUri.parts || [];
              currentUri.parts.push(part);
              if (part.byterange) {
                if (!part.byterange.hasOwnProperty("offset")) {
                  part.byterange.offset = lastPartByterangeEnd;
                }
                lastPartByterangeEnd = part.byterange.offset + part.byterange.length;
              }
              const partIndex = currentUri.parts.length - 1;
              this.warnOnMissingAttributes_(`#EXT-X-PART #${partIndex} for segment #${segmentIndex}`, entry.attributes, ["URI", "DURATION"]);
              if (this.manifest.renditionReports) {
                this.manifest.renditionReports.forEach((r, i) => {
                  if (!r.hasOwnProperty("lastPart")) {
                    this.trigger("warn", {
                      message: `#EXT-X-RENDITION-REPORT #${i} lacks required attribute(s): LAST-PART`
                    });
                  }
                });
              }
            },
            "server-control"() {
              const attrs = this.manifest.serverControl = camelCaseKeys(entry.attributes);
              if (!attrs.hasOwnProperty("canBlockReload")) {
                attrs.canBlockReload = false;
                this.trigger("info", {
                  message: "#EXT-X-SERVER-CONTROL defaulting CAN-BLOCK-RELOAD to false"
                });
              }
              setHoldBack.call(this, this.manifest);
              if (attrs.canSkipDateranges && !attrs.hasOwnProperty("canSkipUntil")) {
                this.trigger("warn", {
                  message: "#EXT-X-SERVER-CONTROL lacks required attribute CAN-SKIP-UNTIL which is required when CAN-SKIP-DATERANGES is set"
                });
              }
            },
            "preload-hint"() {
              const segmentIndex = this.manifest.segments.length;
              const hint = camelCaseKeys(entry.attributes);
              const isPart = hint.type && hint.type === "PART";
              currentUri.preloadHints = currentUri.preloadHints || [];
              currentUri.preloadHints.push(hint);
              if (hint.byterange) {
                if (!hint.byterange.hasOwnProperty("offset")) {
                  hint.byterange.offset = isPart ? lastPartByterangeEnd : 0;
                  if (isPart) {
                    lastPartByterangeEnd = hint.byterange.offset + hint.byterange.length;
                  }
                }
              }
              const index = currentUri.preloadHints.length - 1;
              this.warnOnMissingAttributes_(`#EXT-X-PRELOAD-HINT #${index} for segment #${segmentIndex}`, entry.attributes, ["TYPE", "URI"]);
              if (!hint.type) {
                return;
              }
              for (let i = 0; i < currentUri.preloadHints.length - 1; i++) {
                const otherHint = currentUri.preloadHints[i];
                if (!otherHint.type) {
                  continue;
                }
                if (otherHint.type === hint.type) {
                  this.trigger("warn", {
                    message: `#EXT-X-PRELOAD-HINT #${index} for segment #${segmentIndex} has the same TYPE ${hint.type} as preload hint #${i}`
                  });
                }
              }
            },
            "rendition-report"() {
              const report = camelCaseKeys(entry.attributes);
              this.manifest.renditionReports = this.manifest.renditionReports || [];
              this.manifest.renditionReports.push(report);
              const index = this.manifest.renditionReports.length - 1;
              const required = ["LAST-MSN", "URI"];
              if (hasParts) {
                required.push("LAST-PART");
              }
              this.warnOnMissingAttributes_(`#EXT-X-RENDITION-REPORT #${index}`, entry.attributes, required);
            },
            "part-inf"() {
              this.manifest.partInf = camelCaseKeys(entry.attributes);
              this.warnOnMissingAttributes_("#EXT-X-PART-INF", entry.attributes, ["PART-TARGET"]);
              if (this.manifest.partInf.partTarget) {
                this.manifest.partTargetDuration = this.manifest.partInf.partTarget;
              }
              setHoldBack.call(this, this.manifest);
            },
            "daterange"() {
              this.manifest.dateRanges.push(camelCaseKeys(entry.attributes));
              const index = this.manifest.dateRanges.length - 1;
              this.warnOnMissingAttributes_(`#EXT-X-DATERANGE #${index}`, entry.attributes, ["ID", "START-DATE"]);
              const dateRange = this.manifest.dateRanges[index];
              if (dateRange.endDate && dateRange.startDate && new Date(dateRange.endDate) < new Date(dateRange.startDate)) {
                this.trigger("warn", {
                  message: "EXT-X-DATERANGE END-DATE must be equal to or later than the value of the START-DATE"
                });
              }
              if (dateRange.duration && dateRange.duration < 0) {
                this.trigger("warn", {
                  message: "EXT-X-DATERANGE DURATION must not be negative"
                });
              }
              if (dateRange.plannedDuration && dateRange.plannedDuration < 0) {
                this.trigger("warn", {
                  message: "EXT-X-DATERANGE PLANNED-DURATION must not be negative"
                });
              }
              const endOnNextYes = !!dateRange.endOnNext;
              if (endOnNextYes && !dateRange.class) {
                this.trigger("warn", {
                  message: "EXT-X-DATERANGE with an END-ON-NEXT=YES attribute must have a CLASS attribute"
                });
              }
              if (endOnNextYes && (dateRange.duration || dateRange.endDate)) {
                this.trigger("warn", {
                  message: "EXT-X-DATERANGE with an END-ON-NEXT=YES attribute must not contain DURATION or END-DATE attributes"
                });
              }
              if (dateRange.duration && dateRange.endDate) {
                const startDate = dateRange.startDate;
                const newDateInSeconds = startDate.getTime() + dateRange.duration * 1e3;
                this.manifest.dateRanges[index].endDate = new Date(newDateInSeconds);
              }
              if (!dateRangeTags[dateRange.id]) {
                dateRangeTags[dateRange.id] = dateRange;
              } else {
                for (const attribute in dateRangeTags[dateRange.id]) {
                  if (!!dateRange[attribute] && JSON.stringify(dateRangeTags[dateRange.id][attribute]) !== JSON.stringify(dateRange[attribute])) {
                    this.trigger("warn", {
                      message: "EXT-X-DATERANGE tags with the same ID in a playlist must have the same attributes values"
                    });
                    break;
                  }
                }
                const dateRangeWithSameId = this.manifest.dateRanges.findIndex((dateRangeToFind) => dateRangeToFind.id === dateRange.id);
                this.manifest.dateRanges[dateRangeWithSameId] = _extends(this.manifest.dateRanges[dateRangeWithSameId], dateRange);
                dateRangeTags[dateRange.id] = _extends(dateRangeTags[dateRange.id], dateRange);
                this.manifest.dateRanges.pop();
              }
            },
            "independent-segments"() {
              this.manifest.independentSegments = true;
            },
            "i-frames-only"() {
              this.manifest.iFramesOnly = true;
              this.requiredCompatibilityversion(this.manifest.version, 4);
            },
            "content-steering"() {
              this.manifest.contentSteering = camelCaseKeys(entry.attributes);
              this.warnOnMissingAttributes_("#EXT-X-CONTENT-STEERING", entry.attributes, ["SERVER-URI"]);
            },
            /** @this {Parser} */
            define() {
              this.manifest.definitions = this.manifest.definitions || {};
              const addDef = (n, v) => {
                if (n in this.manifest.definitions) {
                  this.trigger("error", {
                    message: `EXT-X-DEFINE: Duplicate name ${n}`
                  });
                  return;
                }
                this.manifest.definitions[n] = v;
              };
              if ("QUERYPARAM" in entry.attributes) {
                if ("NAME" in entry.attributes || "IMPORT" in entry.attributes) {
                  this.trigger("error", {
                    message: "EXT-X-DEFINE: Invalid attributes"
                  });
                  return;
                }
                const val = this.params.get(entry.attributes.QUERYPARAM);
                if (!val) {
                  this.trigger("error", {
                    message: `EXT-X-DEFINE: No query param ${entry.attributes.QUERYPARAM}`
                  });
                  return;
                }
                addDef(entry.attributes.QUERYPARAM, decodeURIComponent(val));
                return;
              }
              if ("NAME" in entry.attributes) {
                if ("IMPORT" in entry.attributes) {
                  this.trigger("error", {
                    message: "EXT-X-DEFINE: Invalid attributes"
                  });
                  return;
                }
                if (!("VALUE" in entry.attributes) || typeof entry.attributes.VALUE !== "string") {
                  this.trigger("error", {
                    message: `EXT-X-DEFINE: No value for ${entry.attributes.NAME}`
                  });
                  return;
                }
                addDef(entry.attributes.NAME, entry.attributes.VALUE);
                return;
              }
              if ("IMPORT" in entry.attributes) {
                if (!this.mainDefinitions[entry.attributes.IMPORT]) {
                  this.trigger("error", {
                    message: `EXT-X-DEFINE: No value ${entry.attributes.IMPORT} to import, or IMPORT used on main playlist`
                  });
                  return;
                }
                addDef(entry.attributes.IMPORT, this.mainDefinitions[entry.attributes.IMPORT]);
                return;
              }
              this.trigger("error", {
                message: "EXT-X-DEFINE: No attribute"
              });
            },
            "i-frame-playlist"() {
              this.manifest.iFramePlaylists.push({
                attributes: entry.attributes,
                uri: entry.uri,
                timeline: currentTimeline
              });
              this.warnOnMissingAttributes_("#EXT-X-I-FRAME-STREAM-INF", entry.attributes, ["BANDWIDTH", "URI"]);
            }
          }[entry.tagType] || noop).call(self2);
        },
        uri() {
          currentUri.uri = entry.uri;
          uris.push(currentUri);
          if (this.manifest.targetDuration && !("duration" in currentUri)) {
            this.trigger("warn", {
              message: "defaulting segment duration to the target duration"
            });
            currentUri.duration = this.manifest.targetDuration;
          }
          if (key) {
            currentUri.key = key;
          }
          currentUri.timeline = currentTimeline;
          if (currentMap) {
            currentUri.map = currentMap;
          }
          lastPartByterangeEnd = 0;
          if (this.lastProgramDateTime !== null) {
            currentUri.programDateTime = this.lastProgramDateTime;
            this.lastProgramDateTime += currentUri.duration * 1e3;
          }
          currentUri = {};
        },
        comment() {
        },
        custom() {
          if (entry.segment) {
            currentUri.custom = currentUri.custom || {};
            currentUri.custom[entry.customType] = entry.data;
          } else {
            this.manifest.custom = this.manifest.custom || {};
            this.manifest.custom[entry.customType] = entry.data;
          }
        }
      })[entry.type].call(self2);
    });
  }
  requiredCompatibilityversion(currentVersion, targetVersion) {
    if (currentVersion < targetVersion || !currentVersion) {
      this.trigger("warn", {
        message: `manifest must be at least version ${targetVersion}`
      });
    }
  }
  warnOnMissingAttributes_(identifier, attributes, required) {
    const missing = [];
    required.forEach(function(key) {
      if (!attributes.hasOwnProperty(key)) {
        missing.push(key);
      }
    });
    if (missing.length) {
      this.trigger("warn", {
        message: `${identifier} lacks required attribute(s): ${missing.join(", ")}`
      });
    }
  }
  /**
   * Parse the input string and update the manifest object.
   *
   * @param {string} chunk a potentially incomplete portion of the manifest
   */
  push(chunk) {
    this.lineStream.push(chunk);
  }
  /**
   * Flush any remaining input. This can be handy if the last line of an M3U8
   * manifest did not contain a trailing newline but the file has been
   * completely received.
   */
  end() {
    this.lineStream.push("\n");
    if (this.manifest.dateRanges.length && this.lastProgramDateTime === null) {
      this.trigger("warn", {
        message: "A playlist with EXT-X-DATERANGE tag must contain atleast one EXT-X-PROGRAM-DATE-TIME tag"
      });
    }
    this.lastProgramDateTime = null;
    this.trigger("end");
  }
  /**
   * Add an additional parser for non-standard tags
   *
   * @param {Object}   options              a map of options for the added parser
   * @param {RegExp}   options.expression   a regular expression to match the custom header
   * @param {string}   options.customType   the custom type to register to the output
   * @param {Function} [options.dataParser] function to parse the line into an object
   * @param {boolean}  [options.segment]    should tag data be attached to the segment object
   */
  addParser(options) {
    this.parseStream.addParser(options);
  }
  /**
   * Add a custom header mapper
   *
   * @param {Object}   options
   * @param {RegExp}   options.expression   a regular expression to match the custom header
   * @param {Function} options.map          function to translate tag into a different tag
   */
  addTagMapper(options) {
    this.parseStream.addTagMapper(options);
  }
};

// work/browser-build/node_modules/@videojs/vhs-utils/es/resolve-url.js
var import_window2 = __toESM(require_window());
var DEFAULT_LOCATION = "https://example.com";
var resolveUrl = function resolveUrl2(baseUrl, relativeUrl) {
  if (/^[a-z]+:/i.test(relativeUrl)) {
    return relativeUrl;
  }
  if (/^data:/.test(baseUrl)) {
    baseUrl = import_window2.default.location && import_window2.default.location.href || "";
  }
  var protocolLess = /^\/\//.test(baseUrl);
  var removeLocation = !import_window2.default.location && !/\/\//i.test(baseUrl);
  baseUrl = new import_window2.default.URL(baseUrl, import_window2.default.location || DEFAULT_LOCATION);
  var newUrl = new URL(relativeUrl, baseUrl);
  if (removeLocation) {
    return newUrl.href.slice(DEFAULT_LOCATION.length);
  } else if (protocolLess) {
    return newUrl.href.slice(newUrl.protocol.length);
  }
  return newUrl.href;
};
var resolve_url_default = resolveUrl;

// work/browser-build/node_modules/mpd-parser/dist/mpd-parser.es.js
var import_window3 = __toESM(require_window());

// work/browser-build/node_modules/@videojs/vhs-utils/es/media-groups.js
var forEachMediaGroup = function forEachMediaGroup2(master, groups, callback) {
  groups.forEach(function(mediaType) {
    for (var groupKey in master.mediaGroups[mediaType]) {
      for (var labelKey in master.mediaGroups[mediaType][groupKey]) {
        var mediaProperties = master.mediaGroups[mediaType][groupKey][labelKey];
        callback(mediaProperties, mediaType, groupKey, labelKey);
      }
    }
  });
};

// work/browser-build/node_modules/mpd-parser/dist/mpd-parser.es.js
var import_xmldom = __toESM(require_lib());
var isObject = (obj) => {
  return !!obj && typeof obj === "object";
};
var merge = (...objects) => {
  return objects.reduce((result, source) => {
    if (typeof source !== "object") {
      return result;
    }
    Object.keys(source).forEach((key) => {
      if (Array.isArray(result[key]) && Array.isArray(source[key])) {
        result[key] = result[key].concat(source[key]);
      } else if (isObject(result[key]) && isObject(source[key])) {
        result[key] = merge(result[key], source[key]);
      } else {
        result[key] = source[key];
      }
    });
    return result;
  }, {});
};
var values = (o) => Object.keys(o).map((k) => o[k]);
var range = (start, end) => {
  const result = [];
  for (let i = start; i < end; i++) {
    result.push(i);
  }
  return result;
};
var flatten = (lists) => lists.reduce((x, y) => x.concat(y), []);
var from = (list) => {
  if (!list.length) {
    return [];
  }
  const result = [];
  for (let i = 0; i < list.length; i++) {
    result.push(list[i]);
  }
  return result;
};
var findIndexes = (l, key) => l.reduce((a, e, i) => {
  if (e[key]) {
    a.push(i);
  }
  return a;
}, []);
var union = (lists, keyFunction) => {
  return values(lists.reduce((acc, list) => {
    list.forEach((el) => {
      acc[keyFunction(el)] = el;
    });
    return acc;
  }, {}));
};
var errors = {
  INVALID_NUMBER_OF_PERIOD: "INVALID_NUMBER_OF_PERIOD",
  INVALID_NUMBER_OF_CONTENT_STEERING: "INVALID_NUMBER_OF_CONTENT_STEERING",
  DASH_EMPTY_MANIFEST: "DASH_EMPTY_MANIFEST",
  DASH_INVALID_XML: "DASH_INVALID_XML",
  NO_BASE_URL: "NO_BASE_URL",
  MISSING_SEGMENT_INFORMATION: "MISSING_SEGMENT_INFORMATION",
  SEGMENT_TIME_UNSPECIFIED: "SEGMENT_TIME_UNSPECIFIED",
  UNSUPPORTED_UTC_TIMING_SCHEME: "UNSUPPORTED_UTC_TIMING_SCHEME"
};
var urlTypeToSegment = ({
  baseUrl = "",
  source = "",
  range: range2 = "",
  indexRange = ""
}) => {
  const segment = {
    uri: source,
    resolvedUri: resolve_url_default(baseUrl || "", source)
  };
  if (range2 || indexRange) {
    const rangeStr = range2 ? range2 : indexRange;
    const ranges = rangeStr.split("-");
    let startRange = import_window3.default.BigInt ? import_window3.default.BigInt(ranges[0]) : parseInt(ranges[0], 10);
    let endRange = import_window3.default.BigInt ? import_window3.default.BigInt(ranges[1]) : parseInt(ranges[1], 10);
    if (startRange < Number.MAX_SAFE_INTEGER && typeof startRange === "bigint") {
      startRange = Number(startRange);
    }
    if (endRange < Number.MAX_SAFE_INTEGER && typeof endRange === "bigint") {
      endRange = Number(endRange);
    }
    let length;
    if (typeof endRange === "bigint" || typeof startRange === "bigint") {
      length = import_window3.default.BigInt(endRange) - import_window3.default.BigInt(startRange) + import_window3.default.BigInt(1);
    } else {
      length = endRange - startRange + 1;
    }
    if (typeof length === "bigint" && length < Number.MAX_SAFE_INTEGER) {
      length = Number(length);
    }
    segment.byterange = {
      length,
      offset: startRange
    };
  }
  return segment;
};
var byteRangeToString = (byterange) => {
  let endRange;
  if (typeof byterange.offset === "bigint" || typeof byterange.length === "bigint") {
    endRange = import_window3.default.BigInt(byterange.offset) + import_window3.default.BigInt(byterange.length) - import_window3.default.BigInt(1);
  } else {
    endRange = byterange.offset + byterange.length - 1;
  }
  return `${byterange.offset}-${endRange}`;
};
var parseEndNumber = (endNumber) => {
  if (endNumber && typeof endNumber !== "number") {
    endNumber = parseInt(endNumber, 10);
  }
  if (isNaN(endNumber)) {
    return null;
  }
  return endNumber;
};
var segmentRange = {
  /**
   * Returns the entire range of available segments for a static MPD
   *
   * @param {Object} attributes
   *        Inheritied MPD attributes
   * @return {{ start: number, end: number }}
   *         The start and end numbers for available segments
   */
  static(attributes) {
    const {
      duration,
      timescale = 1,
      sourceDuration,
      periodDuration
    } = attributes;
    const endNumber = parseEndNumber(attributes.endNumber);
    const segmentDuration = duration / timescale;
    if (typeof endNumber === "number") {
      return {
        start: 0,
        end: endNumber
      };
    }
    if (typeof periodDuration === "number") {
      return {
        start: 0,
        end: periodDuration / segmentDuration
      };
    }
    return {
      start: 0,
      end: sourceDuration / segmentDuration
    };
  },
  /**
   * Returns the current live window range of available segments for a dynamic MPD
   *
   * @param {Object} attributes
   *        Inheritied MPD attributes
   * @return {{ start: number, end: number }}
   *         The start and end numbers for available segments
   */
  dynamic(attributes) {
    const {
      NOW,
      clientOffset,
      availabilityStartTime,
      timescale = 1,
      duration,
      periodStart = 0,
      minimumUpdatePeriod = 0,
      timeShiftBufferDepth = Infinity
    } = attributes;
    const endNumber = parseEndNumber(attributes.endNumber);
    const now = (NOW + clientOffset) / 1e3;
    const periodStartWC = availabilityStartTime + periodStart;
    const periodEndWC = now + minimumUpdatePeriod;
    const periodDuration = periodEndWC - periodStartWC;
    const segmentCount = Math.ceil(periodDuration * timescale / duration);
    const availableStart = Math.floor((now - periodStartWC - timeShiftBufferDepth) * timescale / duration);
    const availableEnd = Math.floor((now - periodStartWC) * timescale / duration);
    return {
      start: Math.max(0, availableStart),
      end: typeof endNumber === "number" ? endNumber : Math.min(segmentCount, availableEnd)
    };
  }
};
var toSegments = (attributes) => (number) => {
  const {
    duration,
    timescale = 1,
    periodStart,
    startNumber = 1
  } = attributes;
  return {
    number: startNumber + number,
    duration: duration / timescale,
    timeline: periodStart,
    time: number * duration
  };
};
var parseByDuration = (attributes) => {
  const {
    type,
    duration,
    timescale = 1,
    periodDuration,
    sourceDuration
  } = attributes;
  const {
    start,
    end
  } = segmentRange[type](attributes);
  const segments = range(start, end).map(toSegments(attributes));
  if (type === "static") {
    const index = segments.length - 1;
    const sectionDuration = typeof periodDuration === "number" ? periodDuration : sourceDuration;
    segments[index].duration = sectionDuration - duration / timescale * index;
  }
  return segments;
};
var segmentsFromBase = (attributes) => {
  const {
    baseUrl,
    initialization = {},
    sourceDuration,
    indexRange = "",
    periodStart,
    presentationTime,
    number = 0,
    duration
  } = attributes;
  if (!baseUrl) {
    throw new Error(errors.NO_BASE_URL);
  }
  const initSegment = urlTypeToSegment({
    baseUrl,
    source: initialization.sourceURL,
    range: initialization.range
  });
  const segment = urlTypeToSegment({
    baseUrl,
    source: baseUrl,
    indexRange
  });
  segment.map = initSegment;
  if (duration) {
    const segmentTimeInfo = parseByDuration(attributes);
    if (segmentTimeInfo.length) {
      segment.duration = segmentTimeInfo[0].duration;
      segment.timeline = segmentTimeInfo[0].timeline;
    }
  } else if (sourceDuration) {
    segment.duration = sourceDuration;
    segment.timeline = periodStart;
  }
  segment.presentationTime = presentationTime || periodStart;
  segment.number = number;
  return [segment];
};
var addSidxSegmentsToPlaylist$1 = (playlist, sidx, baseUrl) => {
  const initSegment = playlist.sidx.map ? playlist.sidx.map : null;
  const sourceDuration = playlist.sidx.duration;
  const timeline = playlist.timeline || 0;
  const sidxByteRange = playlist.sidx.byterange;
  const sidxEnd = sidxByteRange.offset + sidxByteRange.length;
  const timescale = sidx.timescale;
  const mediaReferences = sidx.references.filter((r) => r.referenceType !== 1);
  const segments = [];
  const type = playlist.endList ? "static" : "dynamic";
  const periodStart = playlist.sidx.timeline;
  let presentationTime = periodStart;
  let number = playlist.mediaSequence || 0;
  let startIndex;
  if (typeof sidx.firstOffset === "bigint") {
    startIndex = import_window3.default.BigInt(sidxEnd) + sidx.firstOffset;
  } else {
    startIndex = sidxEnd + sidx.firstOffset;
  }
  for (let i = 0; i < mediaReferences.length; i++) {
    const reference = sidx.references[i];
    const size = reference.referencedSize;
    const duration = reference.subsegmentDuration;
    let endIndex;
    if (typeof startIndex === "bigint") {
      endIndex = startIndex + import_window3.default.BigInt(size) - import_window3.default.BigInt(1);
    } else {
      endIndex = startIndex + size - 1;
    }
    const indexRange = `${startIndex}-${endIndex}`;
    const attributes = {
      baseUrl,
      timescale,
      timeline,
      periodStart,
      presentationTime,
      number,
      duration,
      sourceDuration,
      indexRange,
      type
    };
    const segment = segmentsFromBase(attributes)[0];
    if (initSegment) {
      segment.map = initSegment;
    }
    segments.push(segment);
    if (typeof startIndex === "bigint") {
      startIndex += import_window3.default.BigInt(size);
    } else {
      startIndex += size;
    }
    presentationTime += duration / timescale;
    number++;
  }
  playlist.segments = segments;
  return playlist;
};
var SUPPORTED_MEDIA_TYPES = ["AUDIO", "SUBTITLES"];
var TIME_FUDGE = 1 / 60;
var getUniqueTimelineStarts = (timelineStarts) => {
  return union(timelineStarts, ({
    timeline
  }) => timeline).sort((a, b) => a.timeline > b.timeline ? 1 : -1);
};
var findPlaylistWithName = (playlists, name) => {
  for (let i = 0; i < playlists.length; i++) {
    if (playlists[i].attributes.NAME === name) {
      return playlists[i];
    }
  }
  return null;
};
var getMediaGroupPlaylists = (manifest) => {
  let mediaGroupPlaylists = [];
  forEachMediaGroup(manifest, SUPPORTED_MEDIA_TYPES, (properties, type, group, label) => {
    mediaGroupPlaylists = mediaGroupPlaylists.concat(properties.playlists || []);
  });
  return mediaGroupPlaylists;
};
var updateMediaSequenceForPlaylist = ({
  playlist,
  mediaSequence
}) => {
  playlist.mediaSequence = mediaSequence;
  playlist.segments.forEach((segment, index) => {
    segment.number = playlist.mediaSequence + index;
  });
};
var updateSequenceNumbers = ({
  oldPlaylists,
  newPlaylists,
  timelineStarts
}) => {
  newPlaylists.forEach((playlist) => {
    playlist.discontinuitySequence = timelineStarts.findIndex(function({
      timeline
    }) {
      return timeline === playlist.timeline;
    });
    const oldPlaylist = findPlaylistWithName(oldPlaylists, playlist.attributes.NAME);
    if (!oldPlaylist) {
      return;
    }
    if (playlist.sidx) {
      return;
    }
    const firstNewSegment = playlist.segments[0];
    const oldMatchingSegmentIndex = oldPlaylist.segments.findIndex(function(oldSegment) {
      return Math.abs(oldSegment.presentationTime - firstNewSegment.presentationTime) < TIME_FUDGE;
    });
    if (oldMatchingSegmentIndex === -1) {
      updateMediaSequenceForPlaylist({
        playlist,
        mediaSequence: oldPlaylist.mediaSequence + oldPlaylist.segments.length
      });
      playlist.segments[0].discontinuity = true;
      playlist.discontinuityStarts.unshift(0);
      if (!oldPlaylist.segments.length && playlist.timeline > oldPlaylist.timeline || oldPlaylist.segments.length && playlist.timeline > oldPlaylist.segments[oldPlaylist.segments.length - 1].timeline) {
        playlist.discontinuitySequence--;
      }
      return;
    }
    const oldMatchingSegment = oldPlaylist.segments[oldMatchingSegmentIndex];
    if (oldMatchingSegment.discontinuity && !firstNewSegment.discontinuity) {
      firstNewSegment.discontinuity = true;
      playlist.discontinuityStarts.unshift(0);
      playlist.discontinuitySequence--;
    }
    updateMediaSequenceForPlaylist({
      playlist,
      mediaSequence: oldPlaylist.segments[oldMatchingSegmentIndex].number
    });
  });
};
var positionManifestOnTimeline = ({
  oldManifest,
  newManifest
}) => {
  const oldPlaylists = oldManifest.playlists.concat(getMediaGroupPlaylists(oldManifest));
  const newPlaylists = newManifest.playlists.concat(getMediaGroupPlaylists(newManifest));
  newManifest.timelineStarts = getUniqueTimelineStarts([oldManifest.timelineStarts, newManifest.timelineStarts]);
  updateSequenceNumbers({
    oldPlaylists,
    newPlaylists,
    timelineStarts: newManifest.timelineStarts
  });
  return newManifest;
};
var generateSidxKey = (sidx) => sidx && sidx.uri + "-" + byteRangeToString(sidx.byterange);
var mergeDiscontiguousPlaylists = (playlists) => {
  const playlistsByBaseUrl = playlists.reduce(function(acc, cur) {
    if (!acc[cur.attributes.baseUrl]) {
      acc[cur.attributes.baseUrl] = [];
    }
    acc[cur.attributes.baseUrl].push(cur);
    return acc;
  }, {});
  let allPlaylists = [];
  Object.values(playlistsByBaseUrl).forEach((playlistGroup) => {
    const mergedPlaylists = values(playlistGroup.reduce((acc, playlist) => {
      const name = playlist.attributes.id + (playlist.attributes.lang || "");
      if (!acc[name]) {
        acc[name] = playlist;
        acc[name].attributes.timelineStarts = [];
      } else {
        if (playlist.segments) {
          if (playlist.segments[0]) {
            playlist.segments[0].discontinuity = true;
          }
          acc[name].segments.push(...playlist.segments);
        }
        if (playlist.attributes.contentProtection) {
          acc[name].attributes.contentProtection = playlist.attributes.contentProtection;
        }
      }
      acc[name].attributes.timelineStarts.push({
        // Although they represent the same number, it's important to have both to make it
        // compatible with HLS potentially having a similar attribute.
        start: playlist.attributes.periodStart,
        timeline: playlist.attributes.periodStart
      });
      return acc;
    }, {}));
    allPlaylists = allPlaylists.concat(mergedPlaylists);
  });
  return allPlaylists.map((playlist) => {
    playlist.discontinuityStarts = findIndexes(playlist.segments || [], "discontinuity");
    return playlist;
  });
};
var addSidxSegmentsToPlaylist = (playlist, sidxMapping) => {
  const sidxKey = generateSidxKey(playlist.sidx);
  const sidxMatch = sidxKey && sidxMapping[sidxKey] && sidxMapping[sidxKey].sidx;
  if (sidxMatch) {
    addSidxSegmentsToPlaylist$1(playlist, sidxMatch, playlist.sidx.resolvedUri);
  }
  return playlist;
};
var addSidxSegmentsToPlaylists = (playlists, sidxMapping = {}) => {
  if (!Object.keys(sidxMapping).length) {
    return playlists;
  }
  for (const i in playlists) {
    playlists[i] = addSidxSegmentsToPlaylist(playlists[i], sidxMapping);
  }
  return playlists;
};
var formatAudioPlaylist = ({
  attributes,
  segments,
  sidx,
  mediaSequence,
  discontinuitySequence,
  discontinuityStarts
}, isAudioOnly) => {
  const playlist = {
    attributes: {
      NAME: attributes.id,
      BANDWIDTH: attributes.bandwidth,
      CODECS: attributes.codecs,
      ["PROGRAM-ID"]: 1
    },
    uri: "",
    endList: attributes.type === "static",
    timeline: attributes.periodStart,
    resolvedUri: attributes.baseUrl || "",
    targetDuration: attributes.duration,
    discontinuitySequence,
    discontinuityStarts,
    timelineStarts: attributes.timelineStarts,
    mediaSequence,
    segments
  };
  if (attributes.contentProtection) {
    playlist.contentProtection = attributes.contentProtection;
  }
  if (attributes.serviceLocation) {
    playlist.attributes.serviceLocation = attributes.serviceLocation;
  }
  if (sidx) {
    playlist.sidx = sidx;
  }
  if (isAudioOnly) {
    playlist.attributes.AUDIO = "audio";
    playlist.attributes.SUBTITLES = "subs";
  }
  return playlist;
};
var formatVttPlaylist = ({
  attributes,
  segments,
  mediaSequence,
  discontinuityStarts,
  discontinuitySequence
}) => {
  if (typeof segments === "undefined") {
    segments = [{
      uri: attributes.baseUrl,
      timeline: attributes.periodStart,
      resolvedUri: attributes.baseUrl || "",
      duration: attributes.sourceDuration,
      number: 0
    }];
    attributes.duration = attributes.sourceDuration;
  }
  const m3u8Attributes = {
    NAME: attributes.id,
    BANDWIDTH: attributes.bandwidth,
    ["PROGRAM-ID"]: 1
  };
  if (attributes.codecs) {
    m3u8Attributes.CODECS = attributes.codecs;
  }
  const vttPlaylist = {
    attributes: m3u8Attributes,
    uri: "",
    endList: attributes.type === "static",
    timeline: attributes.periodStart,
    resolvedUri: attributes.baseUrl || "",
    targetDuration: attributes.duration,
    timelineStarts: attributes.timelineStarts,
    discontinuityStarts,
    discontinuitySequence,
    mediaSequence,
    segments
  };
  if (attributes.serviceLocation) {
    vttPlaylist.attributes.serviceLocation = attributes.serviceLocation;
  }
  return vttPlaylist;
};
var organizeAudioPlaylists = (playlists, sidxMapping = {}, isAudioOnly = false) => {
  let mainPlaylist;
  const formattedPlaylists = playlists.reduce((a, playlist) => {
    const role = playlist.attributes.role && playlist.attributes.role.value || "";
    const language = playlist.attributes.lang || "";
    let label = playlist.attributes.label || "main";
    if (language && !playlist.attributes.label) {
      const roleLabel = role ? ` (${role})` : "";
      label = `${playlist.attributes.lang}${roleLabel}`;
    }
    if (!a[label]) {
      a[label] = {
        language,
        autoselect: true,
        default: role === "main",
        playlists: [],
        uri: ""
      };
    }
    const formatted = addSidxSegmentsToPlaylist(formatAudioPlaylist(playlist, isAudioOnly), sidxMapping);
    a[label].playlists.push(formatted);
    if (typeof mainPlaylist === "undefined" && role === "main") {
      mainPlaylist = playlist;
      mainPlaylist.default = true;
    }
    return a;
  }, {});
  if (!mainPlaylist) {
    const firstLabel = Object.keys(formattedPlaylists)[0];
    formattedPlaylists[firstLabel].default = true;
  }
  return formattedPlaylists;
};
var organizeVttPlaylists = (playlists, sidxMapping = {}) => {
  return playlists.reduce((a, playlist) => {
    const label = playlist.attributes.label || playlist.attributes.lang || "text";
    const language = playlist.attributes.lang || "und";
    if (!a[label]) {
      a[label] = {
        language,
        default: false,
        autoselect: false,
        playlists: [],
        uri: ""
      };
    }
    a[label].playlists.push(addSidxSegmentsToPlaylist(formatVttPlaylist(playlist), sidxMapping));
    return a;
  }, {});
};
var organizeCaptionServices = (captionServices) => captionServices.reduce((svcObj, svc) => {
  if (!svc) {
    return svcObj;
  }
  svc.forEach((service) => {
    const {
      channel,
      language
    } = service;
    svcObj[language] = {
      autoselect: false,
      default: false,
      instreamId: channel,
      language
    };
    if (service.hasOwnProperty("aspectRatio")) {
      svcObj[language].aspectRatio = service.aspectRatio;
    }
    if (service.hasOwnProperty("easyReader")) {
      svcObj[language].easyReader = service.easyReader;
    }
    if (service.hasOwnProperty("3D")) {
      svcObj[language]["3D"] = service["3D"];
    }
  });
  return svcObj;
}, {});
var formatVideoPlaylist = ({
  attributes,
  segments,
  sidx,
  discontinuityStarts
}) => {
  const playlist = {
    attributes: {
      NAME: attributes.id,
      AUDIO: "audio",
      SUBTITLES: "subs",
      RESOLUTION: {
        width: attributes.width,
        height: attributes.height
      },
      CODECS: attributes.codecs,
      BANDWIDTH: attributes.bandwidth,
      ["PROGRAM-ID"]: 1
    },
    uri: "",
    endList: attributes.type === "static",
    timeline: attributes.periodStart,
    resolvedUri: attributes.baseUrl || "",
    targetDuration: attributes.duration,
    discontinuityStarts,
    timelineStarts: attributes.timelineStarts,
    segments
  };
  if (attributes.frameRate) {
    playlist.attributes["FRAME-RATE"] = attributes.frameRate;
  }
  if (attributes.qualityRanking !== void 0) {
    playlist.attributes.SCORE = 1 / (attributes.qualityRanking + 1);
  }
  if (attributes.contentProtection) {
    playlist.contentProtection = attributes.contentProtection;
  }
  if (attributes.serviceLocation) {
    playlist.attributes.serviceLocation = attributes.serviceLocation;
  }
  if (sidx) {
    playlist.sidx = sidx;
  }
  return playlist;
};
var videoOnly = ({
  attributes
}) => attributes.mimeType === "video/mp4" || attributes.mimeType === "video/webm" || attributes.contentType === "video";
var audioOnly = ({
  attributes
}) => attributes.mimeType === "audio/mp4" || attributes.mimeType === "audio/webm" || attributes.contentType === "audio";
var vttOnly = ({
  attributes
}) => attributes.mimeType === "text/vtt" || attributes.contentType === "text";
var addMediaSequenceValues = (playlists, timelineStarts) => {
  playlists.forEach((playlist) => {
    playlist.mediaSequence = 0;
    playlist.discontinuitySequence = timelineStarts.findIndex(function({
      timeline
    }) {
      return timeline === playlist.timeline;
    });
    if (!playlist.segments) {
      return;
    }
    playlist.segments.forEach((segment, index) => {
      segment.number = index;
    });
  });
};
var flattenMediaGroupPlaylists = (mediaGroupObject) => {
  if (!mediaGroupObject) {
    return [];
  }
  return Object.keys(mediaGroupObject).reduce((acc, label) => {
    const labelContents = mediaGroupObject[label];
    return acc.concat(labelContents.playlists);
  }, []);
};
var toM3u8 = ({
  dashPlaylists,
  locations,
  contentSteering,
  sidxMapping = {},
  previousManifest,
  eventStream
}) => {
  if (!dashPlaylists.length) {
    return {};
  }
  const {
    sourceDuration: duration,
    type,
    suggestedPresentationDelay,
    minimumUpdatePeriod
  } = dashPlaylists[0].attributes;
  const videoPlaylists = mergeDiscontiguousPlaylists(dashPlaylists.filter(videoOnly)).map(formatVideoPlaylist);
  const audioPlaylists = mergeDiscontiguousPlaylists(dashPlaylists.filter(audioOnly));
  const vttPlaylists = mergeDiscontiguousPlaylists(dashPlaylists.filter(vttOnly));
  const captions = dashPlaylists.map((playlist) => playlist.attributes.captionServices).filter(Boolean);
  const manifest = {
    allowCache: true,
    discontinuityStarts: [],
    segments: [],
    endList: true,
    mediaGroups: {
      AUDIO: {},
      VIDEO: {},
      ["CLOSED-CAPTIONS"]: {},
      SUBTITLES: {}
    },
    uri: "",
    duration,
    playlists: addSidxSegmentsToPlaylists(videoPlaylists, sidxMapping)
  };
  if (minimumUpdatePeriod >= 0) {
    manifest.minimumUpdatePeriod = minimumUpdatePeriod * 1e3;
  }
  if (locations) {
    manifest.locations = locations;
  }
  if (contentSteering) {
    manifest.contentSteering = contentSteering;
  }
  if (type === "dynamic") {
    manifest.suggestedPresentationDelay = suggestedPresentationDelay;
  }
  if (eventStream && eventStream.length > 0) {
    manifest.eventStream = eventStream;
  }
  const isAudioOnly = manifest.playlists.length === 0;
  const organizedAudioGroup = audioPlaylists.length ? organizeAudioPlaylists(audioPlaylists, sidxMapping, isAudioOnly) : null;
  const organizedVttGroup = vttPlaylists.length ? organizeVttPlaylists(vttPlaylists, sidxMapping) : null;
  const formattedPlaylists = videoPlaylists.concat(flattenMediaGroupPlaylists(organizedAudioGroup), flattenMediaGroupPlaylists(organizedVttGroup));
  const playlistTimelineStarts = formattedPlaylists.map(({
    timelineStarts
  }) => timelineStarts);
  manifest.timelineStarts = getUniqueTimelineStarts(playlistTimelineStarts);
  addMediaSequenceValues(formattedPlaylists, manifest.timelineStarts);
  if (organizedAudioGroup) {
    manifest.mediaGroups.AUDIO.audio = organizedAudioGroup;
  }
  if (organizedVttGroup) {
    manifest.mediaGroups.SUBTITLES.subs = organizedVttGroup;
  }
  if (captions.length) {
    manifest.mediaGroups["CLOSED-CAPTIONS"].cc = organizeCaptionServices(captions);
  }
  if (previousManifest) {
    return positionManifestOnTimeline({
      oldManifest: previousManifest,
      newManifest: manifest
    });
  }
  return manifest;
};
var getLiveRValue = (attributes, time, duration) => {
  const {
    NOW,
    clientOffset,
    availabilityStartTime,
    timescale = 1,
    periodStart = 0,
    minimumUpdatePeriod = 0
  } = attributes;
  const now = (NOW + clientOffset) / 1e3;
  const periodStartWC = availabilityStartTime + periodStart;
  const periodEndWC = now + minimumUpdatePeriod;
  const periodDuration = periodEndWC - periodStartWC;
  return Math.ceil((periodDuration * timescale - time) / duration);
};
var parseByTimeline = (attributes, segmentTimeline) => {
  const {
    type,
    minimumUpdatePeriod = 0,
    media = "",
    sourceDuration,
    timescale = 1,
    startNumber = 1,
    periodStart: timeline
  } = attributes;
  const segments = [];
  let time = -1;
  for (let sIndex = 0; sIndex < segmentTimeline.length; sIndex++) {
    const S = segmentTimeline[sIndex];
    const duration = S.d;
    const repeat = S.r || 0;
    const segmentTime = S.t || 0;
    if (time < 0) {
      time = segmentTime;
    }
    if (segmentTime && segmentTime > time) {
      time = segmentTime;
    }
    let count;
    if (repeat < 0) {
      const nextS = sIndex + 1;
      if (nextS === segmentTimeline.length) {
        if (type === "dynamic" && minimumUpdatePeriod > 0 && media.indexOf("$Number$") > 0) {
          count = getLiveRValue(attributes, time, duration);
        } else {
          count = (sourceDuration * timescale - time) / duration;
        }
      } else {
        count = (segmentTimeline[nextS].t - time) / duration;
      }
    } else {
      count = repeat + 1;
    }
    const end = startNumber + segments.length + count;
    let number = startNumber + segments.length;
    while (number < end) {
      segments.push({
        number,
        duration: duration / timescale,
        time,
        timeline
      });
      time += duration;
      number++;
    }
  }
  return segments;
};
var identifierPattern = /\$([A-z]*)(?:(%0)([0-9]+)d)?\$/g;
var identifierReplacement = (values2) => (match, identifier, format, width) => {
  if (match === "$$") {
    return "$";
  }
  if (typeof values2[identifier] === "undefined") {
    return match;
  }
  const value = "" + values2[identifier];
  if (identifier === "RepresentationID") {
    return value;
  }
  if (!format) {
    width = 1;
  } else {
    width = parseInt(width, 10);
  }
  if (value.length >= width) {
    return value;
  }
  return `${new Array(width - value.length + 1).join("0")}${value}`;
};
var constructTemplateUrl = (url, values2) => url.replace(identifierPattern, identifierReplacement(values2));
var parseTemplateInfo = (attributes, segmentTimeline) => {
  if (!attributes.duration && !segmentTimeline) {
    return [{
      number: attributes.startNumber || 1,
      duration: attributes.sourceDuration,
      time: 0,
      timeline: attributes.periodStart
    }];
  }
  if (attributes.duration) {
    return parseByDuration(attributes);
  }
  return parseByTimeline(attributes, segmentTimeline);
};
var segmentsFromTemplate = (attributes, segmentTimeline) => {
  const templateValues = {
    RepresentationID: attributes.id,
    Bandwidth: attributes.bandwidth || 0
  };
  const {
    initialization = {
      sourceURL: "",
      range: ""
    }
  } = attributes;
  const mapSegment = urlTypeToSegment({
    baseUrl: attributes.baseUrl,
    source: constructTemplateUrl(initialization.sourceURL, templateValues),
    range: initialization.range
  });
  const segments = parseTemplateInfo(attributes, segmentTimeline);
  return segments.map((segment) => {
    templateValues.Number = segment.number;
    templateValues.Time = segment.time;
    const uri = constructTemplateUrl(attributes.media || "", templateValues);
    const timescale = attributes.timescale || 1;
    const presentationTimeOffset = attributes.presentationTimeOffset || 0;
    const presentationTime = (
      // Even if the @t attribute is not specified for the segment, segment.time is
      // calculated in mpd-parser prior to this, so it's assumed to be available.
      attributes.periodStart + (segment.time - presentationTimeOffset) / timescale
    );
    const map = {
      uri,
      timeline: segment.timeline,
      duration: segment.duration,
      resolvedUri: resolve_url_default(attributes.baseUrl || "", uri),
      map: mapSegment,
      number: segment.number,
      presentationTime
    };
    return map;
  });
};
var SegmentURLToSegmentObject = (attributes, segmentUrl) => {
  const {
    baseUrl,
    initialization = {}
  } = attributes;
  const initSegment = urlTypeToSegment({
    baseUrl,
    source: initialization.sourceURL,
    range: initialization.range
  });
  const segment = urlTypeToSegment({
    baseUrl,
    source: segmentUrl.media,
    range: segmentUrl.mediaRange
  });
  segment.map = initSegment;
  return segment;
};
var segmentsFromList = (attributes, segmentTimeline) => {
  const {
    duration,
    segmentUrls = [],
    periodStart
  } = attributes;
  if (!duration && !segmentTimeline || duration && segmentTimeline) {
    throw new Error(errors.SEGMENT_TIME_UNSPECIFIED);
  }
  const segmentUrlMap = segmentUrls.map((segmentUrlObject) => SegmentURLToSegmentObject(attributes, segmentUrlObject));
  let segmentTimeInfo;
  if (duration) {
    segmentTimeInfo = parseByDuration(attributes);
  }
  if (segmentTimeline) {
    segmentTimeInfo = parseByTimeline(attributes, segmentTimeline);
  }
  const segments = segmentTimeInfo.map((segmentTime, index) => {
    if (segmentUrlMap[index]) {
      const segment = segmentUrlMap[index];
      const timescale = attributes.timescale || 1;
      const presentationTimeOffset = attributes.presentationTimeOffset || 0;
      segment.timeline = segmentTime.timeline;
      segment.duration = segmentTime.duration;
      segment.number = segmentTime.number;
      segment.presentationTime = periodStart + (segmentTime.time - presentationTimeOffset) / timescale;
      return segment;
    }
  }).filter((segment) => segment);
  return segments;
};
var generateSegments = ({
  attributes,
  segmentInfo
}) => {
  let segmentAttributes;
  let segmentsFn;
  if (segmentInfo.template) {
    segmentsFn = segmentsFromTemplate;
    segmentAttributes = merge(attributes, segmentInfo.template);
  } else if (segmentInfo.base) {
    segmentsFn = segmentsFromBase;
    segmentAttributes = merge(attributes, segmentInfo.base);
  } else if (segmentInfo.list) {
    segmentsFn = segmentsFromList;
    segmentAttributes = merge(attributes, segmentInfo.list);
  }
  const segmentsInfo = {
    attributes
  };
  if (!segmentsFn) {
    return segmentsInfo;
  }
  const segments = segmentsFn(segmentAttributes, segmentInfo.segmentTimeline);
  if (segmentAttributes.duration) {
    const {
      duration,
      timescale = 1
    } = segmentAttributes;
    segmentAttributes.duration = duration / timescale;
  } else if (segments.length) {
    segmentAttributes.duration = segments.reduce((max, segment) => {
      return Math.max(max, Math.ceil(segment.duration));
    }, 0);
  } else {
    segmentAttributes.duration = 0;
  }
  segmentsInfo.attributes = segmentAttributes;
  segmentsInfo.segments = segments;
  if (segmentInfo.base && segmentAttributes.indexRange) {
    segmentsInfo.sidx = segments[0];
    segmentsInfo.segments = [];
  }
  return segmentsInfo;
};
var toPlaylists = (representations) => representations.map(generateSegments);
var findChildren = (element, name) => from(element.childNodes).filter(({
  tagName
}) => tagName === name);
var getContent = (element) => element.textContent.trim();
var parseDivisionValue = (value) => {
  return parseFloat(value.split("/").reduce((prev, current) => prev / current));
};
var parseDuration = (str) => {
  const SECONDS_IN_YEAR = 365 * 24 * 60 * 60;
  const SECONDS_IN_MONTH = 30 * 24 * 60 * 60;
  const SECONDS_IN_DAY = 24 * 60 * 60;
  const SECONDS_IN_HOUR = 60 * 60;
  const SECONDS_IN_MIN = 60;
  const durationRegex = /P(?:(\d*)Y)?(?:(\d*)M)?(?:(\d*)D)?(?:T(?:(\d*)H)?(?:(\d*)M)?(?:([\d.]*)S)?)?/;
  const match = durationRegex.exec(str);
  if (!match) {
    return 0;
  }
  const [year, month, day, hour, minute, second] = match.slice(1);
  return parseFloat(year || 0) * SECONDS_IN_YEAR + parseFloat(month || 0) * SECONDS_IN_MONTH + parseFloat(day || 0) * SECONDS_IN_DAY + parseFloat(hour || 0) * SECONDS_IN_HOUR + parseFloat(minute || 0) * SECONDS_IN_MIN + parseFloat(second || 0);
};
var parseDate = (str) => {
  const dateRegex = /^\d+-\d+-\d+T\d+:\d+:\d+(\.\d+)?$/;
  if (dateRegex.test(str)) {
    str += "Z";
  }
  return Date.parse(str);
};
var parsers = {
  /**
   * Specifies the duration of the entire Media Presentation. Format is a duration string
   * as specified in ISO 8601
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The duration in seconds
   */
  mediaPresentationDuration(value) {
    return parseDuration(value);
  },
  /**
   * Specifies the Segment availability start time for all Segments referred to in this
   * MPD. For a dynamic manifest, it specifies the anchor for the earliest availability
   * time. Format is a date string as specified in ISO 8601
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The date as seconds from unix epoch
   */
  availabilityStartTime(value) {
    return parseDate(value) / 1e3;
  },
  /**
   * Specifies the smallest period between potential changes to the MPD. Format is a
   * duration string as specified in ISO 8601
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The duration in seconds
   */
  minimumUpdatePeriod(value) {
    return parseDuration(value);
  },
  /**
   * Specifies the suggested presentation delay. Format is a
   * duration string as specified in ISO 8601
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The duration in seconds
   */
  suggestedPresentationDelay(value) {
    return parseDuration(value);
  },
  /**
   * specifices the type of mpd. Can be either "static" or "dynamic"
   *
   * @param {string} value
   *        value of attribute as a string
   *
   * @return {string}
   *         The type as a string
   */
  type(value) {
    return value;
  },
  /**
   * Specifies the duration of the smallest time shifting buffer for any Representation
   * in the MPD. Format is a duration string as specified in ISO 8601
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The duration in seconds
   */
  timeShiftBufferDepth(value) {
    return parseDuration(value);
  },
  /**
   * Specifies the PeriodStart time of the Period relative to the availabilityStarttime.
   * Format is a duration string as specified in ISO 8601
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The duration in seconds
   */
  start(value) {
    return parseDuration(value);
  },
  /**
   * Specifies the width of the visual presentation
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The parsed width
   */
  width(value) {
    return parseInt(value, 10);
  },
  /**
   * Specifies the height of the visual presentation
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The parsed height
   */
  height(value) {
    return parseInt(value, 10);
  },
  /**
   * Specifies the bitrate of the representation
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The parsed bandwidth
   */
  bandwidth(value) {
    return parseInt(value, 10);
  },
  /**
   * Specifies the frame rate of the representation
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The parsed frame rate
   */
  frameRate(value) {
    return parseDivisionValue(value);
  },
  /**
   * Specifies the number of the first Media Segment in this Representation in the Period
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The parsed number
   */
  startNumber(value) {
    return parseInt(value, 10);
  },
  /**
   * Specifies the timescale in units per seconds
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The parsed timescale
   */
  timescale(value) {
    return parseInt(value, 10);
  },
  /**
   * Specifies the presentationTimeOffset.
   *
   * @param {string} value
   *        value of the attribute as a string
   *
   * @return {number}
   *         The parsed presentationTimeOffset
   */
  presentationTimeOffset(value) {
    return parseInt(value, 10);
  },
  /**
   * Specifies the constant approximate Segment duration
   * NOTE: The <Period> element also contains an @duration attribute. This duration
   *       specifies the duration of the Period. This attribute is currently not
   *       supported by the rest of the parser, however we still check for it to prevent
   *       errors.
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The parsed duration
   */
  duration(value) {
    const parsedValue = parseInt(value, 10);
    if (isNaN(parsedValue)) {
      return parseDuration(value);
    }
    return parsedValue;
  },
  /**
   * Specifies the Segment duration, in units of the value of the @timescale.
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The parsed duration
   */
  d(value) {
    return parseInt(value, 10);
  },
  /**
   * Specifies the MPD start time, in @timescale units, the first Segment in the series
   * starts relative to the beginning of the Period
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The parsed time
   */
  t(value) {
    return parseInt(value, 10);
  },
  /**
   * Specifies the repeat count of the number of following contiguous Segments with the
   * same duration expressed by the value of @d
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {number}
   *         The parsed number
   */
  r(value) {
    return parseInt(value, 10);
  },
  /**
   * Specifies the presentationTime.
   *
   * @param {string} value
   *        value of the attribute as a string
   *
   * @return {number}
   *         The parsed presentationTime
   */
  presentationTime(value) {
    return parseInt(value, 10);
  },
  /**
   * Specifies the quality ranking of the representation relative to others in the same
   * adaptation set. This is inversely related to quality - higher values represent
   * lower quality content (e.g., 1 = highest quality, 10 = lowest quality).
   *
   * @param {string} value
   *        value of the attribute as a string
   *
   * @return {number}
   *         The parsed qualityRanking
   */
  qualityRanking(value) {
    return parseInt(value, 10);
  },
  /**
   * Alias for qualityRanking to handle lowercase attribute names from HTML DOM.
   *
   * @param {string} value
   *        value of the attribute as a string
   *
   * @return {number}
   *         The parsed qualityRanking
   */
  qualityranking(value) {
    return parseInt(value, 10);
  },
  /**
   * Default parser for all other attributes. Acts as a no-op and just returns the value
   * as a string
   *
   * @param {string} value
   *        value of attribute as a string
   * @return {string}
   *         Unparsed value
   */
  DEFAULT(value) {
    return value;
  }
};
var attributeNameMap = {
  qualityranking: "qualityRanking"
};
var parseAttributes2 = (el) => {
  if (!(el && el.attributes)) {
    return {};
  }
  return from(el.attributes).reduce((a, e) => {
    const parseFn = parsers[e.name] || parsers.DEFAULT;
    const attributeName = attributeNameMap[e.name] || e.name;
    a[attributeName] = parseFn(e.value);
    return a;
  }, {});
};
var keySystemsMap = {
  "urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b": "org.w3.clearkey",
  "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed": "com.widevine.alpha",
  "urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95": "com.microsoft.playready",
  "urn:uuid:f239e769-efa3-4850-9c16-a903c6932efb": "com.adobe.primetime",
  // ISO_IEC 23009-1_2022 5.8.5.2.2 The mp4 Protection Scheme
  "urn:mpeg:dash:mp4protection:2011": "mp4protection"
};
var buildBaseUrls = (references, baseUrlElements) => {
  if (!baseUrlElements.length) {
    return references;
  }
  return flatten(references.map(function(reference) {
    return baseUrlElements.map(function(baseUrlElement) {
      const initialBaseUrl = getContent(baseUrlElement);
      const resolvedBaseUrl = resolve_url_default(reference.baseUrl, initialBaseUrl);
      const finalBaseUrl = merge(parseAttributes2(baseUrlElement), {
        baseUrl: resolvedBaseUrl
      });
      if (resolvedBaseUrl !== initialBaseUrl && !finalBaseUrl.serviceLocation && reference.serviceLocation) {
        finalBaseUrl.serviceLocation = reference.serviceLocation;
      }
      return finalBaseUrl;
    });
  }));
};
var getSegmentInformation = (adaptationSet) => {
  const segmentTemplate = findChildren(adaptationSet, "SegmentTemplate")[0];
  const segmentList = findChildren(adaptationSet, "SegmentList")[0];
  const segmentUrls = segmentList && findChildren(segmentList, "SegmentURL").map((s) => merge({
    tag: "SegmentURL"
  }, parseAttributes2(s)));
  const segmentBase = findChildren(adaptationSet, "SegmentBase")[0];
  const segmentTimelineParentNode = segmentList || segmentTemplate;
  const segmentTimeline = segmentTimelineParentNode && findChildren(segmentTimelineParentNode, "SegmentTimeline")[0];
  const segmentInitializationParentNode = segmentList || segmentBase || segmentTemplate;
  const segmentInitialization = segmentInitializationParentNode && findChildren(segmentInitializationParentNode, "Initialization")[0];
  const template = segmentTemplate && parseAttributes2(segmentTemplate);
  if (template && segmentInitialization) {
    template.initialization = segmentInitialization && parseAttributes2(segmentInitialization);
  } else if (template && template.initialization) {
    template.initialization = {
      sourceURL: template.initialization
    };
  }
  const segmentInfo = {
    template,
    segmentTimeline: segmentTimeline && findChildren(segmentTimeline, "S").map((s) => parseAttributes2(s)),
    list: segmentList && merge(parseAttributes2(segmentList), {
      segmentUrls,
      initialization: parseAttributes2(segmentInitialization)
    }),
    base: segmentBase && merge(parseAttributes2(segmentBase), {
      initialization: parseAttributes2(segmentInitialization)
    })
  };
  Object.keys(segmentInfo).forEach((key) => {
    if (!segmentInfo[key]) {
      delete segmentInfo[key];
    }
  });
  return segmentInfo;
};
var inheritBaseUrls = (adaptationSetAttributes, adaptationSetBaseUrls, adaptationSetSegmentInfo) => (representation) => {
  const repBaseUrlElements = findChildren(representation, "BaseURL");
  const repBaseUrls = buildBaseUrls(adaptationSetBaseUrls, repBaseUrlElements);
  const attributes = merge(adaptationSetAttributes, parseAttributes2(representation));
  const representationSegmentInfo = getSegmentInformation(representation);
  return repBaseUrls.map((baseUrl) => {
    return {
      segmentInfo: merge(adaptationSetSegmentInfo, representationSegmentInfo),
      attributes: merge(attributes, baseUrl)
    };
  });
};
var generateKeySystemInformation = (contentProtectionNodes) => {
  return contentProtectionNodes.reduce((acc, node) => {
    const attributes = parseAttributes2(node);
    if (attributes.schemeIdUri) {
      attributes.schemeIdUri = attributes.schemeIdUri.toLowerCase();
    }
    const keySystem = keySystemsMap[attributes.schemeIdUri];
    if (keySystem) {
      acc[keySystem] = {
        attributes
      };
      const psshNode = findChildren(node, "cenc:pssh")[0];
      if (psshNode) {
        const pssh = getContent(psshNode);
        acc[keySystem].pssh = pssh && decodeB64ToUint8Array(pssh);
      }
    }
    return acc;
  }, {});
};
var parseCaptionServiceMetadata = (service) => {
  if (service.schemeIdUri === "urn:scte:dash:cc:cea-608:2015") {
    const values2 = typeof service.value !== "string" ? [] : service.value.split(";");
    return values2.map((value) => {
      let channel;
      let language;
      language = value;
      if (/^CC\d=/.test(value)) {
        [channel, language] = value.split("=");
      } else if (/^CC\d$/.test(value)) {
        channel = value;
      }
      return {
        channel,
        language
      };
    });
  } else if (service.schemeIdUri === "urn:scte:dash:cc:cea-708:2015") {
    const values2 = typeof service.value !== "string" ? [] : service.value.split(";");
    return values2.map((value) => {
      const flags = {
        // service or channel number 1-63
        "channel": void 0,
        // language is a 3ALPHA per ISO 639.2/B
        // field is required
        "language": void 0,
        // BIT 1/0 or ?
        // default value is 1, meaning 16:9 aspect ratio, 0 is 4:3, ? is unknown
        "aspectRatio": 1,
        // BIT 1/0
        // easy reader flag indicated the text is tailed to the needs of beginning readers
        // default 0, or off
        "easyReader": 0,
        // BIT 1/0
        // If 3d metadata is present (CEA-708.1) then 1
        // default 0
        "3D": 0
      };
      if (/=/.test(value)) {
        const [channel, opts = ""] = value.split("=");
        flags.channel = channel;
        flags.language = value;
        opts.split(",").forEach((opt) => {
          const [name, val] = opt.split(":");
          if (name === "lang") {
            flags.language = val;
          } else if (name === "er") {
            flags.easyReader = Number(val);
          } else if (name === "war") {
            flags.aspectRatio = Number(val);
          } else if (name === "3D") {
            flags["3D"] = Number(val);
          }
        });
      } else {
        flags.language = value;
      }
      if (flags.channel) {
        flags.channel = "SERVICE" + flags.channel;
      }
      return flags;
    });
  }
};
var toEventStream = (period) => {
  return flatten(findChildren(period.node, "EventStream").map((eventStream) => {
    const eventStreamAttributes = parseAttributes2(eventStream);
    const schemeIdUri = eventStreamAttributes.schemeIdUri;
    return findChildren(eventStream, "Event").map((event) => {
      const eventAttributes = parseAttributes2(event);
      const presentationTime = eventAttributes.presentationTime || 0;
      const timescale = eventStreamAttributes.timescale || 1;
      const duration = eventAttributes.duration || 0;
      const start = presentationTime / timescale + period.attributes.start;
      return {
        schemeIdUri,
        value: eventStreamAttributes.value,
        id: eventAttributes.id,
        start,
        end: start + duration / timescale,
        messageData: getContent(event) || eventAttributes.messageData,
        contentEncoding: eventStreamAttributes.contentEncoding,
        presentationTimeOffset: eventStreamAttributes.presentationTimeOffset || 0
      };
    });
  }));
};
var toRepresentations = (periodAttributes, periodBaseUrls, periodSegmentInfo) => (adaptationSet) => {
  const adaptationSetAttributes = parseAttributes2(adaptationSet);
  const adaptationSetBaseUrls = buildBaseUrls(periodBaseUrls, findChildren(adaptationSet, "BaseURL"));
  const role = findChildren(adaptationSet, "Role")[0];
  const roleAttributes = {
    role: parseAttributes2(role)
  };
  let attrs = merge(periodAttributes, adaptationSetAttributes, roleAttributes);
  const accessibility = findChildren(adaptationSet, "Accessibility")[0];
  const captionServices = parseCaptionServiceMetadata(parseAttributes2(accessibility));
  if (captionServices) {
    attrs = merge(attrs, {
      captionServices
    });
  }
  const label = findChildren(adaptationSet, "Label")[0];
  if (label && label.childNodes.length) {
    const labelVal = label.childNodes[0].nodeValue.trim();
    attrs = merge(attrs, {
      label: labelVal
    });
  }
  const contentProtection = generateKeySystemInformation(findChildren(adaptationSet, "ContentProtection"));
  if (Object.keys(contentProtection).length) {
    attrs = merge(attrs, {
      contentProtection
    });
  }
  const segmentInfo = getSegmentInformation(adaptationSet);
  const representations = findChildren(adaptationSet, "Representation");
  const adaptationSetSegmentInfo = merge(periodSegmentInfo, segmentInfo);
  return flatten(representations.map(inheritBaseUrls(attrs, adaptationSetBaseUrls, adaptationSetSegmentInfo)));
};
var toAdaptationSets = (mpdAttributes, mpdBaseUrls) => (period, index) => {
  const periodBaseUrls = buildBaseUrls(mpdBaseUrls, findChildren(period.node, "BaseURL"));
  const periodAttributes = merge(mpdAttributes, {
    periodStart: period.attributes.start
  });
  if (typeof period.attributes.duration === "number") {
    periodAttributes.periodDuration = period.attributes.duration;
  }
  const adaptationSets = findChildren(period.node, "AdaptationSet");
  const periodSegmentInfo = getSegmentInformation(period.node);
  return flatten(adaptationSets.map(toRepresentations(periodAttributes, periodBaseUrls, periodSegmentInfo)));
};
var generateContentSteeringInformation = (contentSteeringNodes, eventHandler) => {
  if (contentSteeringNodes.length > 1) {
    eventHandler({
      type: "warn",
      message: "The MPD manifest should contain no more than one ContentSteering tag"
    });
  }
  if (!contentSteeringNodes.length) {
    return null;
  }
  const infoFromContentSteeringTag = merge({
    serverURL: getContent(contentSteeringNodes[0])
  }, parseAttributes2(contentSteeringNodes[0]));
  infoFromContentSteeringTag.queryBeforeStart = infoFromContentSteeringTag.queryBeforeStart === "true";
  return infoFromContentSteeringTag;
};
var getPeriodStart = ({
  attributes,
  priorPeriodAttributes,
  mpdType
}) => {
  if (typeof attributes.start === "number") {
    return attributes.start;
  }
  if (priorPeriodAttributes && typeof priorPeriodAttributes.start === "number" && typeof priorPeriodAttributes.duration === "number") {
    return priorPeriodAttributes.start + priorPeriodAttributes.duration;
  }
  if (!priorPeriodAttributes && mpdType === "static") {
    return 0;
  }
  return null;
};
var inheritAttributes = (mpd, options = {}) => {
  const {
    manifestUri = "",
    NOW = Date.now(),
    clientOffset = 0,
    // TODO: For now, we are expecting an eventHandler callback function
    // to be passed into the mpd parser as an option.
    // In the future, we should enable stream parsing by using the Stream class from vhs-utils.
    // This will support new features including a standardized event handler.
    // See the m3u8 parser for examples of how stream parsing is currently used for HLS parsing.
    // https://github.com/videojs/vhs-utils/blob/88d6e10c631e57a5af02c5a62bc7376cd456b4f5/src/stream.js#L9
    eventHandler = function() {
    }
  } = options;
  const periodNodes = findChildren(mpd, "Period");
  if (!periodNodes.length) {
    throw new Error(errors.INVALID_NUMBER_OF_PERIOD);
  }
  const locations = findChildren(mpd, "Location");
  const mpdAttributes = parseAttributes2(mpd);
  const mpdBaseUrls = buildBaseUrls([{
    baseUrl: manifestUri
  }], findChildren(mpd, "BaseURL"));
  const contentSteeringNodes = findChildren(mpd, "ContentSteering");
  mpdAttributes.type = mpdAttributes.type || "static";
  mpdAttributes.sourceDuration = mpdAttributes.mediaPresentationDuration || 0;
  mpdAttributes.NOW = NOW;
  mpdAttributes.clientOffset = clientOffset;
  if (locations.length) {
    mpdAttributes.locations = locations.map(getContent);
  }
  const periods = [];
  periodNodes.forEach((node, index) => {
    const attributes = parseAttributes2(node);
    const priorPeriod = periods[index - 1];
    attributes.start = getPeriodStart({
      attributes,
      priorPeriodAttributes: priorPeriod ? priorPeriod.attributes : null,
      mpdType: mpdAttributes.type
    });
    periods.push({
      node,
      attributes
    });
  });
  return {
    locations: mpdAttributes.locations,
    contentSteeringInfo: generateContentSteeringInformation(contentSteeringNodes, eventHandler),
    // TODO: There are occurences where this `representationInfo` array contains undesired
    // duplicates. This generally occurs when there are multiple BaseURL nodes that are
    // direct children of the MPD node. When we attempt to resolve URLs from a combination of the
    // parent BaseURL and a child BaseURL, and the value does not resolve,
    // we end up returning the child BaseURL multiple times.
    // We need to determine a way to remove these duplicates in a safe way.
    // See: https://github.com/videojs/mpd-parser/pull/17#discussion_r162750527
    representationInfo: flatten(periods.map(toAdaptationSets(mpdAttributes, mpdBaseUrls))),
    eventStream: flatten(periods.map(toEventStream))
  };
};
var stringToMpdXml = (manifestString) => {
  if (manifestString === "") {
    throw new Error(errors.DASH_EMPTY_MANIFEST);
  }
  const parser = new import_xmldom.DOMParser();
  let xml;
  let mpd;
  try {
    xml = parser.parseFromString(manifestString, "application/xml");
    mpd = xml && xml.documentElement.tagName === "MPD" ? xml.documentElement : null;
  } catch (e) {
  }
  if (!mpd || mpd && mpd.getElementsByTagName("parsererror").length > 0) {
    throw new Error(errors.DASH_INVALID_XML);
  }
  return mpd;
};
var parse = (manifestString, options = {}) => {
  const parsedManifestInfo = inheritAttributes(stringToMpdXml(manifestString), options);
  const playlists = toPlaylists(parsedManifestInfo.representationInfo);
  return toM3u8({
    dashPlaylists: playlists,
    locations: parsedManifestInfo.locations,
    contentSteering: parsedManifestInfo.contentSteeringInfo,
    sidxMapping: options.sidxMapping,
    previousManifest: options.previousManifest,
    eventStream: parsedManifestInfo.eventStream
  });
};
export {
  Parser as HlsParser,
  parse as parseDash
};
/*! Bundled license information:

m3u8-parser/dist/m3u8-parser.es.js:
  (*! @name m3u8-parser @version 7.2.0 @license Apache-2.0 *)

mpd-parser/dist/mpd-parser.es.js:
  (*! @name mpd-parser @version 1.4.0 @license Apache-2.0 *)
*/

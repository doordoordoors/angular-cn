/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {browserDetection} from '@angular/platform-browser/testing/src/browser_util';

import {getDOM} from '../../src/dom/dom_adapter';
import {sanitizeHtml} from '../../src/security/html_sanitizer';

{
  describe('HTML sanitizer', () => {
    let defaultDoc: any;
    let originalLog: (msg: any) => any = null !;
    let logMsgs: string[];

    beforeEach(() => {
      defaultDoc = getDOM().supportsDOMEvents() ? document : getDOM().createHtmlDocument();
      logMsgs = [];
      originalLog = getDOM().log;  // Monkey patch DOM.log.
      getDOM().log = (msg) => logMsgs.push(msg);
    });

    afterEach(() => { getDOM().log = originalLog; });

    it('serializes nested structures', () => {
      expect(sanitizeHtml(defaultDoc, '<div alt="x"><p>a</p>b<b>c<a alt="more">d</a></b>e</div>'))
          .toEqual('<div alt="x"><p>a</p>b<b>c<a alt="more">d</a></b>e</div>');
      expect(logMsgs).toEqual([]);
    });

    it('serializes self closing elements', () => {
      expect(sanitizeHtml(defaultDoc, '<p>Hello <br> World</p>'))
          .toEqual('<p>Hello <br> World</p>');
    });

    it('supports namespaced elements',
       () => { expect(sanitizeHtml(defaultDoc, 'a<my:hr/><my:div>b</my:div>c')).toEqual('abc'); });

    it('supports namespaced attributes', () => {
      expect(sanitizeHtml(defaultDoc, '<a xlink:href="something">t</a>'))
          .toEqual('<a xlink:href="something">t</a>');
      expect(sanitizeHtml(defaultDoc, '<a xlink:evil="something">t</a>')).toEqual('<a>t</a>');
      expect(sanitizeHtml(defaultDoc, '<a xlink:href="javascript:foo()">t</a>'))
          .toEqual('<a xlink:href="unsafe:javascript:foo()">t</a>');
    });

    it('supports HTML5 elements', () => {
      expect(sanitizeHtml(defaultDoc, '<main><summary>Works</summary></main>'))
          .toEqual('<main><summary>Works</summary></main>');
    });

    it('sanitizes srcset attributes', () => {
      expect(sanitizeHtml(defaultDoc, '<img srcset="/foo.png 400px, javascript:evil() 23px">'))
          .toEqual('<img srcset="/foo.png 400px, unsafe:javascript:evil() 23px">');
    });

    it('supports sanitizing plain text',
       () => { expect(sanitizeHtml(defaultDoc, 'Hello, World')).toEqual('Hello, World'); });

    it('ignores non-element, non-attribute nodes', () => {
      expect(sanitizeHtml(defaultDoc, '<!-- comments? -->no.')).toEqual('no.');
      expect(sanitizeHtml(defaultDoc, '<?pi nodes?>no.')).toEqual('no.');
      expect(logMsgs.join('\n')).toMatch(/sanitizing HTML stripped some content/);
    });

    it('supports sanitizing escaped entities', () => {
      expect(sanitizeHtml(defaultDoc, '&#128640;')).toEqual('&#128640;');
      expect(logMsgs).toEqual([]);
    });

    it('does not warn when just re-encoding text', () => {
      expect(sanitizeHtml(defaultDoc, '<p>Hellö Wörld</p>'))
          .toEqual('<p>Hell&#246; W&#246;rld</p>');
      expect(logMsgs).toEqual([]);
    });

    it('escapes entities', () => {
      expect(sanitizeHtml(defaultDoc, '<p>Hello &lt; World</p>'))
          .toEqual('<p>Hello &lt; World</p>');
      expect(sanitizeHtml(defaultDoc, '<p>Hello < World</p>')).toEqual('<p>Hello &lt; World</p>');
      expect(sanitizeHtml(defaultDoc, '<p alt="% &amp; &quot; !">Hello</p>'))
          .toEqual('<p alt="% &amp; &#34; !">Hello</p>');  // NB: quote encoded as ASCII &#34;.
    });

    describe('should strip dangerous elements', () => {
      const dangerousTags = [
        'frameset', 'form', 'param', 'object', 'embed', 'textarea', 'input', 'button', 'option',
        'select', 'script', 'style', 'link', 'base', 'basefont'
      ];

      for (const tag of dangerousTags) {
        it(`${tag}`,
           () => { expect(sanitizeHtml(defaultDoc, `<${tag}>evil!</${tag}>`)).toEqual('evil!'); });
      }

      it(`swallows frame entirely`, () => {
        expect(sanitizeHtml(defaultDoc, `<frame>evil!</frame>`)).not.toContain('<frame>');
      });
    });

    describe('should strip dangerous attributes', () => {
      const dangerousAttrs = ['id', 'name', 'style'];

      for (const attr of dangerousAttrs) {
        it(`${attr}`, () => {
          expect(sanitizeHtml(defaultDoc, `<a ${attr}="x">evil!</a>`)).toEqual('<a>evil!</a>');
        });
      }
    });

    it('should not enter an infinite loop on clobbered elements', () => {
      // Some browsers are vulnerable to clobbered elements and will throw an expected exception
      // IE and EDGE does not seems to be affected by those cases
      // Anyway what we want to test is that browsers do not enter an infinite loop which would
      // result in a timeout error for the test.
      try {
        sanitizeHtml(defaultDoc, '<form><input name="parentNode" /></form>');
      } catch (e) {
        // depending on the browser, we might ge an exception
      }
      try {
        sanitizeHtml(defaultDoc, '<form><input name="nextSibling" /></form>');
      } catch (e) {
        // depending on the browser, we might ge an exception
      }
      try {
        sanitizeHtml(defaultDoc, '<form><div><div><input name="nextSibling" /></div></div></form>');
      } catch (e) {
        // depending on the browser, we might ge an exception
      }
    });

    // See
    // https://github.com/cure53/DOMPurify/blob/a992d3a75031cb8bb032e5ea8399ba972bdf9a65/src/purify.js#L439-L449
    it('should not allow JavaScript execution when creating inert document', () => {
      const output = sanitizeHtml(defaultDoc, '<svg><g onload="window.xxx = 100"></g></svg>');
      const window = defaultDoc.defaultView;
      if (window) {
        expect(window.xxx).toBe(undefined);
        window.xxx = undefined;
      }
      expect(output).toEqual('');
    });

    // See https://github.com/cure53/DOMPurify/releases/tag/0.6.7
    it('should not allow JavaScript hidden in badly formed HTML to get through sanitization (Firefox bug)',
       () => {
         expect(sanitizeHtml(
                    defaultDoc, '<svg><p><style><img src="</style><img src=x onerror=alert(1)//">'))
             .toEqual(
                 isDOMParserAvailable() ?
                     // PlatformBrowser output
                     '<p>&lt;img src=&#34;<img src="x"></p>' :
                     // PlatformServer output
                     '<p><img src="&lt;/style&gt;&lt;img src=x onerror=alert(1)//"></p>');
       });

    if (browserDetection.isWebkit) {
      it('should prevent mXSS attacks', function() {
        // In Chrome Canary 62, the ideographic space character is kept as a stringified HTML entity
        expect(sanitizeHtml(defaultDoc, '<a href="&#x3000;javascript:alert(1)">CLICKME</a>'))
            .toMatch(/<a href="unsafe:(&#12288;)?javascript:alert\(1\)">CLICKME<\/a>/);
      });
    }
  });
}

/**
 * We need to determine whether the DOMParser exists in the global context.
 * The try-catch is because, on some browsers, trying to access this property
 * on window can actually throw an error.
 *
 * @suppress {uselessCode}
 */
function isDOMParserAvailable() {
  try {
    return !!(window as any).DOMParser;
  } catch (e) {
    return false;
  }
}

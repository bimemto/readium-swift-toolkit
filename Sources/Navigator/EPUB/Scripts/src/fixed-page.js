//
//  Copyright 2025 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Page layout types.
export const PageType = {
  SINGLE: 'single',
  SPREAD_LEFT: 'spread-left',
  SPREAD_RIGHT: 'spread-right',
  SPREAD_CENTER: 'spread-center',
};

// Fit modes for scaling content.
export const Fit = {
  AUTO: 'auto',
  PAGE: 'page',
  WIDTH: 'width',
};

// Manages a fixed layout resource embedded in an iframe.
// @param iframeId - ID of the iframe element
// @param pageType - Type of page layout from PageType enum
export function FixedPage(iframeId, pageType) {
  // Fixed dimensions for the page, extracted from the viewport meta tag.
  var _pageSize = null;
  // Available viewport size to fill with the resource.
  var _viewportSize = null;
  // Margins that should not overlap the content.
  var _safeAreaInsets = null;
  // Fit mode for scaling the page.
  var _fit = Fit.AUTO;
  // Type of page layout (determines centering behavior).
  var _pageType = Object.values(PageType).includes(pageType)
    ? pageType
    : PageType.SINGLE;

  // iFrame containing the page.
  var _iframe = document.getElementById(iframeId);
  _iframe.addEventListener('load', loadPageSize);

  // Viewport element containing the iFrame.
  var _viewport = _iframe.closest('.viewport');

  // Loads the page size of the loaded resource.
  function loadPageSize() {
    var doc = _iframe.contentWindow.document;
    var size = viewportSize(doc) || naturalSize(doc);
    if (size) {
      _pageSize = size;
      layoutPage();
    }
  }

  // Parses the page size from the viewport meta tag.
  function viewportSize(doc) {
    var viewport = doc.querySelector('meta[name=viewport]');
    if (!viewport) {
      return null;
    }
    var regex = /(\w+) *= *([^\s,]+)/g;
    var properties = {};
    var match;
    while ((match = regex.exec(viewport.content))) {
      properties[match[1]] = match[2];
    }
    var width = Number.parseFloat(properties.width);
    var height = Number.parseFloat(properties.height);
    return width && height ? { width: width, height: height } : null;
  }

  // GOG: a page without a usable viewport (none, `device-width`, or the spine
  // item is an SVG or image file) used to stay 0x0, i.e. blank. Fall back to
  // the size of its content.
  function naturalSize(doc) {
    var root = doc.documentElement;
    var svg = root && root.localName === 'svg' ? root : null;
    var img = svg ? null : doc.querySelector('img');
    if (img && img.naturalWidth && img.naturalHeight) {
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    svg = svg || doc.querySelector('svg');
    var box = svg && svg.viewBox && svg.viewBox.baseVal;
    return box && box.width && box.height
      ? { width: box.width, height: box.height }
      : null;
  }

  // Layouts the page iframe and scale it according to the current fit mode.
  function layoutPage() {
    if (!_pageSize || !_viewportSize || !_safeAreaInsets) {
      return;
    }

    _iframe.style.width = _pageSize.width + 'px';
    _iframe.style.height = _pageSize.height + 'px';

    // Calculates the zoom scale required to fit the content to the viewport.
    var widthRatio = _viewportSize.width / _pageSize.width;
    var heightRatio = _viewportSize.height / _pageSize.height;
    var scale;

    switch (_fit) {
      case Fit.WIDTH:
        // Fit to width only.
        scale = widthRatio;
        break;
      // Auto is equivalent to page in paginated mode, we don't have a scroll mode for FXL.
      case Fit.AUTO:
      case Fit.PAGE:
      default:
        // Fit both dimensions.
        scale = Math.min(widthRatio, heightRatio);
        break;
    }

    // Calculate the scaled height of the content
    var scaledHeight = _pageSize.height * scale;

    // Determine the appropriate transform based on page type.
    // Single page and center page in spread need horizontal centering.
    // Left/right pages in spread don't need horizontal transform.
    var needsHorizontalCenter =
      _pageType === PageType.SINGLE || _pageType === PageType.SPREAD_CENTER;

    // For width fit, if content overflows vertically, align to top
    // For page fit, center the content vertically
    if (_fit === Fit.WIDTH && scaledHeight > _viewportSize.height) {
      // Content overflows: align to top with safe area inset
      // Override the CSS centering
      _iframe.style.top = _safeAreaInsets.top + 'px';
      if (needsHorizontalCenter) {
        _iframe.style.transform = 'translateX(-50%)';
      } else {
        _iframe.style.transform = 'none';
      }
    } else {
      // Content fits or is page fit: center vertically
      // Keep the CSS centering but adjust for safe area insets
      var verticalOffset = _safeAreaInsets.top - _safeAreaInsets.bottom;
      _iframe.style.top = 'calc(50% + ' + verticalOffset + 'px)';
      if (needsHorizontalCenter) {
        _iframe.style.transform = 'translate(-50%, -50%)';
      } else {
        _iframe.style.transform = 'translateY(-50%)';
      }
    }

    // Sets the viewport of the wrapper page (this page) to scale the iframe.
    var viewport = document.querySelector('meta[name=viewport]');
    viewport.content = 'initial-scale=' + scale + ', minimum-scale=' + scale;
  }

  return {
    // Returns whether the page is currently loading its contents.
    isLoading: false,

    // Link object for the resource currently loaded in the page.
    link: null,

    // Loads the given resource ({link, url}) in the page.
    load: function (resource, completion) {
      if (!resource.link || !resource.url) {
        if (completion) {
          completion();
        }
        return;
      }

      var page = this;
      page.link = resource.link;
      page.isLoading = true;

      function loaded() {
        _iframe.removeEventListener('load', loaded);

        // Timeout to wait for the page to be laid out.
        // Note that using `requestAnimationFrame()` instead causes performance
        // issues in some FXL EPUBs with spreads.
        setTimeout(function () {
          page.isLoading = false;
          // GOG: an SVG or image page has no `readium` object; the spread must
          // still report loaded or the navigator waits forever.
          try {
            _iframe.contentWindow.eval(
              `readium.link = ${JSON.stringify(resource.link)};`,
            );
          } catch (e) {}
          if (completion) {
            completion();
          }
        }, 100);
      }

      _iframe.addEventListener('load', loaded);
      _iframe.src = resource.url;
    },

    // Resets the page and empty its contents.
    reset: function () {
      if (!this.link) {
        return;
      }
      this.link = null;
      _pageSize = null;
      _iframe.src = 'about:blank';
    },

    // Evaluates a script in the context of the page.
    eval: function (script) {
      if (!this.link || this.isLoading) {
        return;
      }
      return _iframe.contentWindow.eval(script);
    },

    // Updates the available viewport to display the resource.
    setViewport: function (viewportSize, safeAreaInsets, fit) {
      _viewportSize = viewportSize;
      _safeAreaInsets = safeAreaInsets;
      if (Object.values(Fit).includes(fit)) {
        _fit = fit;
      }
      layoutPage();
    },

    // Shows the page's viewport.
    show: function () {
      _viewport.style.display = 'block';
    },

    // Hides the page's viewport.
    hide: function () {
      _viewport.style.display = 'none';
    },
  };
}

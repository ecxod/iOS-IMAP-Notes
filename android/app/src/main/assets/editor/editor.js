/* global SUNEDITOR, NativeEditor */
(function () {
  "use strict";

  var MAX_IMAGE_BYTES = 6 * 1024 * 1024;
  var DATA_IMAGE_PATTERN = /^data:(image\/(?:gif|jpeg|png|webp));base64,([a-z0-9+/=\s]+)$/i;
  var CONTENT_ID_PATTERN = /^[^<>\s\r\n]+$/;
  var supportedTypes = {
    "image/gif": true,
    "image/jpeg": true,
    "image/png": true,
    "image/webp": true
  };
  var editor;
  var suppressChanges = true;
  var loadedImageMetadata = [];

  function bridge(method, value) {
    if (typeof NativeEditor !== "undefined" && typeof NativeEditor[method] === "function") {
      NativeEditor[method](value == null ? "" : String(value));
    }
  }

  function cleanContentId(value) {
    var contentId = String(value || "").trim().replace(/^<|>$/g, "");
    return CONTENT_ID_PATTERN.test(contentId) ? contentId : "";
  }

  function randomContentId() {
    var values = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(values);
    } else {
      for (var index = 0; index < values.length; index += 1) {
        values[index] = Math.floor(Math.random() * 256);
      }
    }
    values[6] = (values[6] & 15) | 64;
    values[8] = (values[8] & 63) | 128;
    var hex = [];
    for (var byteIndex = 0; byteIndex < values.length; byteIndex += 1) {
      hex.push((values[byteIndex] + 256).toString(16).slice(1));
    }
    return (hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-"
      + hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-"
      + hex.slice(10).join("")).toUpperCase() + "@mobilenotes.apple.com";
  }

  function sanitizeHtml(html, preserveAppleObjects) {
    var template = document.createElement("template");
    template.innerHTML = String(html || "");
    var forbidden = template.content.querySelectorAll("script,iframe,frame,embed,form,base,meta,link");
    for (var forbiddenIndex = 0; forbiddenIndex < forbidden.length; forbiddenIndex += 1) {
      forbidden[forbiddenIndex].remove();
    }
    var objects = template.content.querySelectorAll("object");
    for (var objectIndex = 0; objectIndex < objects.length; objectIndex += 1) {
      var object = objects[objectIndex];
      var data = object.getAttribute("data") || "";
      if (!preserveAppleObjects
          || object.getAttribute("type") !== "application/x-apple-msg-attachment"
          || data.slice(0, 4).toLowerCase() !== "cid:"
          || !cleanContentId(data.slice(4))) {
        object.remove();
      } else {
        var objectAttributes = Array.prototype.slice.call(object.attributes);
        for (var objectAttributeIndex = 0; objectAttributeIndex < objectAttributes.length; objectAttributeIndex += 1) {
          var objectAttribute = objectAttributes[objectAttributeIndex];
          if (objectAttribute.name !== "type" && objectAttribute.name !== "data") {
            object.removeAttribute(objectAttribute.name);
          }
        }
      }
    }
    var elements = template.content.querySelectorAll("*");
    for (var elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      var element = elements[elementIndex];
      var attributes = Array.prototype.slice.call(element.attributes);
      for (var attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
        var attribute = attributes[attributeIndex];
        var name = attribute.name.toLowerCase();
        var value = attribute.value.trim().toLowerCase();
        if (name.slice(0, 2) === "on"
            || ((name === "href" || name === "src" || name === "xlink:href")
              && value.slice(0, 11) === "javascript:")) {
          element.removeAttribute(attribute.name);
        }
      }
      if (element.tagName === "IMG" && !DATA_IMAGE_PATTERN.test(element.getAttribute("src") || "")) {
        element.remove();
      }
    }
    return template.innerHTML;
  }

  function editorHtml(bodyHtml, images) {
    var template = document.createElement("template");
    template.innerHTML = String(bodyHtml || "");
    var imageMap = {};
    loadedImageMetadata = [];
    for (var imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      var imageValue = images[imageIndex];
      var imageContentId = cleanContentId(imageValue.contentId);
      if (imageContentId) {
        imageMap[imageContentId.toLowerCase()] = imageValue;
      }
    }
    var objects = template.content.querySelectorAll("object");
    for (var objectIndex = 0; objectIndex < objects.length; objectIndex += 1) {
      var object = objects[objectIndex];
      var data = object.getAttribute("data") || "";
      var contentId = data.slice(0, 4).toLowerCase() === "cid:" ? cleanContentId(data.slice(4)) : "";
      var image = imageMap[contentId.toLowerCase()];
      if (object.getAttribute("type") === "application/x-apple-msg-attachment" && image) {
        var img = document.createElement("img");
        img.setAttribute("src", "data:" + image.contentType + ";base64," + image.dataBase64);
        img.setAttribute("alt", image.filename || "Bild");
        img.setAttribute("data-apple-content-id", image.contentId);
        img.setAttribute("data-apple-content-type", image.contentType);
        img.setAttribute("data-apple-filename", image.filename || "image");
        img.setAttribute("data-file-name", image.filename || "image");
        img.setAttribute("data-file-size", String(Math.floor(image.dataBase64.length * 3 / 4)));
        loadedImageMetadata.push({
          src: img.getAttribute("src"),
          contentId: image.contentId,
          contentType: image.contentType,
          filename: image.filename || "image"
        });
        object.replaceWith(img);
      } else {
        var placeholder = document.createElement("div");
        placeholder.className = "unsupported-attachment";
        placeholder.textContent = "[Nicht unterstützter Anhang]";
        object.replaceWith(placeholder);
      }
    }
    return sanitizeHtml(template.innerHTML, false);
  }

  function parseDataImage(element, originalImages) {
    var src = String(element.getAttribute("src") || "");
    var match = src.match(DATA_IMAGE_PATTERN);
    if (!match) {
      throw new Error("Nur lokale JPEG-, PNG-, GIF- oder WebP-Bilder können gespeichert werden.");
    }
    var dataBase64 = match[2].replace(/\s+/g, "");
    var byteLength;
    try {
      byteLength = window.atob(dataBase64).length;
    } catch (error) {
      throw new Error("Ein eingefügtes Bild enthält ungültige Daten.");
    }
    if (!byteLength) {
      throw new Error("Ein eingefügtes Bild ist leer.");
    }
    var contentType = match[1].toLowerCase();
    var extension = contentType === "image/jpeg" ? "jpg" : contentType.slice(6);
    var originalIndex = -1;
    for (var index = 0; index < originalImages.length; index += 1) {
      if (originalImages[index].src === src) {
        originalIndex = index;
        break;
      }
    }
    var original = originalIndex >= 0 ? originalImages.splice(originalIndex, 1)[0] : null;
    var contentId = cleanContentId(element.getAttribute("data-apple-content-id"))
      || cleanContentId(original && original.contentId)
      || randomContentId();
    var filename = String(
        element.getAttribute("data-apple-filename")
        || element.getAttribute("data-file-name")
        || (original && original.filename)
        || "image." + extension
    ).replace(/[\r\n"\\]/g, "_").slice(0, 240);
    return {
      contentId: contentId,
      contentType: contentType,
      filename: filename,
      dataBase64: dataBase64,
      byteLength: byteLength
    };
  }

  function exportNote() {
    var template = document.createElement("template");
    template.innerHTML = String(editor.getContents() || "");
    var imageElements = template.content.querySelectorAll("img");
    var imagesById = {};
    var images = [];
    var totalBytes = 0;
    var originalImages = loadedImageMetadata.slice();
    for (var imageIndex = 0; imageIndex < imageElements.length; imageIndex += 1) {
      var image = parseDataImage(imageElements[imageIndex], originalImages);
      var key = image.contentId.toLowerCase();
      if (imagesById[key]
          && (imagesById[key].contentType !== image.contentType
            || imagesById[key].dataBase64 !== image.dataBase64)) {
        throw new Error("Zwei verschiedene Bilder verwenden dieselbe interne Content-ID.");
      }
      if (!imagesById[key]) {
        imagesById[key] = image;
        images.push({
          contentId: image.contentId,
          contentType: image.contentType,
          filename: image.filename,
          dataBase64: image.dataBase64
        });
        totalBytes += image.byteLength;
      }
      var object = document.createElement("object");
      object.setAttribute("type", "application/x-apple-msg-attachment");
      object.setAttribute("data", "cid:" + image.contentId);
      imageElements[imageIndex].replaceWith(object);
    }
    if (totalBytes > MAX_IMAGE_BYTES) {
      throw new Error("Bilder dürfen zusammen höchstens 6 MB groß sein.");
    }
    return {
      bodyHtml: sanitizeHtml(template.innerHTML, true),
      images: images
    };
  }

  function setLanguage(tag) {
    var editable = document.querySelector(".se-wrapper-wysiwyg");
    if (editable) {
      editable.setAttribute("lang", tag || document.documentElement.lang || "de");
      editable.setAttribute("spellcheck", "true");
    }
  }

  window.noteEditor = {
    loadNote: function (bodyHtml, images, readOnly) {
      suppressChanges = true;
      editor.setContents(editorHtml(bodyHtml, Array.isArray(images) ? images : []));
      editor.readOnly(Boolean(readOnly));
      setLanguage("");
      suppressChanges = false;
    },
    exportJson: function () {
      try {
        return JSON.stringify({ ok: true, note: exportNote() });
      } catch (error) {
        return JSON.stringify({ ok: false, error: error.message || String(error) });
      }
    },
    setLanguage: setLanguage,
    setReadOnly: function (readOnly) {
      editor.readOnly(Boolean(readOnly));
    }
  };

  editor = SUNEDITOR.create("editor", {
    width: "100%",
    height: "100%",
    minHeight: "180px",
    resizingBar: false,
    showPathLabel: false,
    buttonList: [
      ["undo", "redo"],
      ["bold", "underline", "italic"],
      ["list", "outdent", "indent"],
      ["link", "image"],
      ["removeFormat"]
    ],
    imageAccept: "image/jpeg,image/png,image/gif,image/webp",
    imageFileInput: true,
    imageMultipleFile: true,
    imageUploadSizeLimit: MAX_IMAGE_BYTES,
    imageUrlInput: false
  });
  editor.onChange = function () {
    if (!suppressChanges) {
      bridge("changed", "");
    }
  };
  editor.onImageUploadBefore = function (files) {
    for (var index = 0; index < files.length; index += 1) {
      if (!supportedTypes[files[index].type]) {
        bridge("error", "Nur JPEG-, PNG-, GIF- und WebP-Bilder werden unterstützt.");
        return false;
      }
    }
    return true;
  };
  suppressChanges = false;
  setLanguage("");
  bridge("ready", "");
}());

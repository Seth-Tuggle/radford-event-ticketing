(function () {
  var API_BASE = "https://service.example.invalid/production/Group-2";
  var LIST_EVENTS_PATH = "";
  var SEARCH_EVENTS_PATH = "/events";
  var GET_EVENT_BY_ID_PATH = "{id}";
  var GET_EVENTS_BY_CATEGORY_PATH = "{id}/categories";
  var GET_EVENT_CATEGORIES_PATH = "/events/{id}/categories";
  var GET_EVENTS_BY_DATE_PATH = "/Date";
  var GET_EVENT_IMAGE_METADATA_PATH = "/events/{eventId}/images";
  var DOC_DOWNLOAD_PATH_CANDIDATES = [
    "/events/{eventId}/documents/{docKey}/download",
    "/events/{eventId}/documents/{docKey}"
  ];
  var CREATE_EVENT_PATH = "/Create-Event";
  var UPDATE_EVENT_PATH = "/Update-Event/{id}";
  var CANCEL_EVENT_PATH = "/events/{id}";
  var IMAGE_PRESIGN_PATH = "/events/{eventId}/images/presign";
  var DOC_PRESIGN_PATH = "/events/{eventId}/documents/presign";

  var CATEGORIES = [
    "Sports",
    "Baseball",
    "Basketball",
    "Cross Country",
    "Golf",
    "Soccer",
    "Track and Field",
    "Lacrosse",
    "Softball",
    "Volleyball",
    "Music",
    "Conference",
    "Speech",
    "Performance",
    "Honors",
    "Academic"
  ];

  var VENUE_LAYOUTS = [
    {
      venueName: "Preston Hall",
      layouts: [
        { layoutName: "All Section", capacity: 1500 },
        { layoutName: "Middle Section", capacity: 1000 }
      ]
    },
    {
      venueName: "Bonnie Auditorium",
      layouts: [
        { layoutName: "All Section", capacity: 150 }
      ]
    },
    {
      venueName: "Muse Banquet Hall",
      layouts: [
        { layoutName: "Banquet", capacity: 150 },
        { layoutName: "Classroom", capacity: 175 },
        { layoutName: "Theater", capacity: 200 }
      ]
    },
    {
      venueName: "Dedmon Center",
      layouts: [
        { layoutName: "All Section", capacity: 3200 },
        { layoutName: "Graduation Style", capacity: 2500 }
      ]
    }
  ];

  var DEFAULT_PLACEHOLDER_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 420'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop stop-color='%23172033'/%3E%3Cstop offset='1' stop-color='%23ff8f4c'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='420' fill='url(%23g)'/%3E%3Cpath d='M0 310 L145 210 L260 282 L355 170 L640 315 V420 H0 Z' fill='rgba(255,255,255,0.18)'/%3E%3Ctext x='48' y='92' font-family='Trebuchet MS, sans-serif' font-size='32' fill='white'%3ERadford Event%3C/text%3E%3Ctext x='48' y='132' font-family='Trebuchet MS, sans-serif' font-size='18' fill='rgba(255,255,255,0.8)'%3ELive campus moments, one tap away%3C/text%3E%3C/svg%3E";

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return text;
    }
  }

  function readText(value, fallback) {
    var text = value == null ? "" : String(value).trim();
    return text || (fallback || "");
  }

  function toList(value) {
    if (Array.isArray(value)) {
      return value.slice();
    }
    if (typeof value === "string") {
      return value.split(",").map(function (item) { return item.trim(); }).filter(Boolean);
    }
    return [];
  }

  function uniqueStrings(values) {
    var seen = {};
    var result = [];
    (values || []).forEach(function (value) {
      var key = readText(value, "");
      if (!key || seen[key]) {
        return;
      }
      seen[key] = true;
      result.push(key);
    });
    return result;
  }

  function normalizeBaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function buildRoute(path, params) {
    var replaced = String(path || "");
    Object.keys(params || {}).forEach(function (key) {
      replaced = replaced.replace(new RegExp("\\{" + key + "\\}", "g"), encodeURIComponent(params[key] || ""));
    });
    return replaced;
  }

  function buildUrl(path, params) {
    var route = buildRoute(path, params || {});
    if (/^https?:\/\//i.test(route)) {
      return route;
    }

    var cleanBase = normalizeBaseUrl(API_BASE);
    var cleanPath = String(route || "").replace(/^\/+/, "");
    return cleanPath ? cleanBase + "/" + cleanPath : cleanBase;
  }

  function appendQueryParams(url, params) {
    var searchParams = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value == null || value === "") {
        return;
      }
      searchParams.set(key, String(value));
    });
    var query = searchParams.toString();
    if (!query) {
      return url;
    }
    return url + (url.indexOf("?") === -1 ? "?" : "&") + query;
  }

  function encodePathSegments(path) {
    return String(path || "")
      .split("/")
      .map(function (segment) { return encodeURIComponent(segment); })
      .join("/");
  }

  function formatDateTime(value) {
    if (!value) {
      return "TBD";
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function formatDayHeading(value) {
    if (!value) {
      return "Unknown day";
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleDateString([], {
      weekday: "long",
      month: "short",
      day: "numeric"
    });
  }

  function formatDateInput(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function formatMoney(value) {
    if (value == null || value === "") {
      return "";
    }
    var numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric <= 0 ? "Free" : "$" + numeric.toFixed(2);
    }
    return String(value);
  }

  function formatPriceSummary(eventData) {
    var budget = formatMoney(eventData && eventData.budget_price);
    var standard = formatMoney(eventData && eventData.standard_price);
    var vip = formatMoney(eventData && eventData.vip_price);
    var parts = [];
    if (budget) {
      parts.push("B " + budget);
    }
    if (standard) {
      parts.push("S " + standard);
    }
    if (vip) {
      parts.push("V " + vip);
    }
    if (parts.length > 0) {
      return parts.join(" | ");
    }
    return formatMoney(eventData && eventData.price) || "Free";
  }

  function truncateText(value, maxLength) {
    var text = readText(value, "");
    if (!text) {
      return "No description provided.";
    }
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
  }

  function startOfToday() {
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }

  function addDays(date, amount) {
    var result = new Date(date.getTime());
    result.setDate(result.getDate() + amount);
    return result;
  }

  function extensionFromFilename(name) {
    var index = String(name || "").lastIndexOf(".");
    return index >= 0 ? String(name).slice(index + 1).toLowerCase() : "";
  }

  function fallbackEventId() {
    return "evt-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function generateEventId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return fallbackEventId();
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function toApiDateTime(localValue) {
    if (!localValue) {
      return "";
    }

    var date = new Date(localValue);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    var year = date.getFullYear();
    var month = pad2(date.getMonth() + 1);
    var day = pad2(date.getDate());
    var hour = pad2(date.getHours());
    var minute = pad2(date.getMinutes());
    var second = pad2(date.getSeconds());
    var offsetMinutes = -date.getTimezoneOffset();
    var sign = offsetMinutes >= 0 ? "+" : "-";
    var absOffset = Math.abs(offsetMinutes);
    var offsetHour = pad2(Math.floor(absOffset / 60));
    var offsetMinute = pad2(absOffset % 60);

    return year + "-" + month + "-" + day + "T" + hour + ":" + minute + ":" + second + sign + offsetHour + ":" + offsetMinute;
  }

  function parseOptionalInt(rawValue, min, max, label) {
    if (!rawValue) {
      return "";
    }
    var parsed = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new Error(label + " must be between " + min + " and " + max + ".");
    }
    return parsed;
  }

  function extractAssetPath(value) {
    if (typeof value === "string") {
      return value;
    }
    if (!value || typeof value !== "object") {
      return "";
    }
    return readText(
      value.url ||
      value.href ||
      value.path ||
      value.key ||
      value.s3Key ||
      value.location ||
      "",
      ""
    );
  }

  function extractAssetLabel(value, fallback) {
    if (!value || typeof value !== "object") {
      return fallback;
    }
    return readText(value.name || value.fileName || value.title || "", fallback);
  }

  function deriveAssetBases(eventData) {
    var bases = [];
    [
      "asset_base_url",
      "assets_base_url",
      "base_url",
      "cdn_url",
      "cdn_base_url",
      "files_base_url",
      "file_base_url",
      "image_base_url",
      "images_base_url",
      "documents_base_url",
      "document_base_url"
    ].forEach(function (field) {
      var value = readText(eventData && eventData[field], "");
      if (/^https?:\/\//i.test(value)) {
        bases.push(normalizeBaseUrl(value));
      }
    });

    [
      "bucket",
      "bucket_name",
      "s3_bucket",
      "assets_bucket",
      "images_bucket",
      "documents_bucket"
    ].forEach(function (field) {
      var bucket = readText(eventData && eventData[field], "");
      if (bucket && bucket.indexOf("/") === -1) {
        bases.push("https://" + bucket + ".s3.amazonaws.com");
      }
    });

    return uniqueStrings(bases);
  }

  function resolveAssetUrl(rawValue, assetBases) {
    var value = extractAssetPath(rawValue);
    if (!value) {
      return "";
    }
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
    if (/^s3:\/\//i.test(value)) {
      var s3Parts = value.replace(/^s3:\/\//i, "").split("/");
      var bucket = s3Parts.shift();
      var s3Key = s3Parts.join("/");
      return "https://" + bucket + ".s3.amazonaws.com/" + encodePathSegments(s3Key);
    }
    if (Array.isArray(assetBases) && assetBases.length > 0) {
      return normalizeBaseUrl(assetBases[0]) + "/" + encodePathSegments(value);
    }
    return "";
  }

  function pickItems(payload) {
    if (!payload) {
      return [];
    }
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload.items)) {
      return payload.items;
    }
    if (Array.isArray(payload.events)) {
      return payload.events;
    }
    if (payload.data && Array.isArray(payload.data.items)) {
      return payload.data.items;
    }
    return [];
  }

  function pickEventData(payload) {
    if (!payload || typeof payload !== "object") {
      return {};
    }
    return payload.item || payload.event || payload.data || payload;
  }

  function pickEventId(eventData) {
    return readText(
      eventData && (
        eventData.event_id ||
        eventData.id ||
        eventData.eventId ||
        eventData.pk
      ),
      ""
    );
  }

  function pickHero(eventData) {
    var assetBases = deriveAssetBases(eventData || {});
    var images = toList((eventData && (eventData.images || eventData.image_urls || eventData.photos)) || []);
    for (var i = 0; i < images.length; i += 1) {
      var resolved = resolveAssetUrl(images[i], assetBases);
      if (resolved) {
        return resolved;
      }
    }
    var hero = resolveAssetUrl(eventData && eventData.hero_image, assetBases);
    return hero || DEFAULT_PLACEHOLDER_IMAGE;
  }

  async function request(url, options) {
    var response = await fetch(url, options || {});
    if (response.status === 204) {
      return null;
    }

    var text = await response.text();
    var data = safeJsonParse(text);
    if (!response.ok) {
      var message = "Request failed";
      if (data && typeof data === "object") {
        message = readText(data.message || data.error || data.detail || "", message);
      } else if (typeof data === "string" && data.trim()) {
        message = data.trim();
      }
      var error = new Error(message + " (" + response.status + ")");
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  async function fetchUpcoming(limit) {
    var url = buildUrl(LIST_EVENTS_PATH);
    if (limit) {
      url = appendQueryParams(url, { limit: limit });
    }
    return request(url, { method: "GET" });
  }

  async function searchEvents(query, limit, nextToken) {
    var params = {};
    if (query) {
      params.q = query;
    }
    if (query && limit) {
      params.limit = limit;
    }
    if (query && nextToken) {
      params.nextToken = nextToken;
    }

    var url = buildUrl(SEARCH_EVENTS_PATH);
    if (Object.keys(params).length > 0) {
      url = appendQueryParams(url, params);
    }
    return request(url, { method: "GET" });
  }

  async function fetchByCategory(category, limit) {
    var params = { category: category };
    if (limit) {
      params.limit = limit;
    }
    var url = appendQueryParams(
      buildUrl(GET_EVENTS_BY_CATEGORY_PATH, { id: category || "" }),
      params
    );
    return request(url, { method: "GET" });
  }

  async function fetchByDate(options) {
    var params = {
      type: readText(options && options.type, "both")
    };

    if (options && options.date) {
      params.date = options.date;
    } else {
      params.startDate = options && options.startDate;
      params.endDate = options && options.endDate;
    }
    if (options && options.limit) {
      params.limit = options.limit;
    }
    if (options && options.nextToken) {
      params.nextToken = options.nextToken;
    }

    var url = appendQueryParams(buildUrl(GET_EVENTS_BY_DATE_PATH), params);
    return request(url, { method: "GET" });
  }

  async function fetchEventById(eventId) {
    return request(buildUrl(GET_EVENT_BY_ID_PATH, { id: eventId }), { method: "GET" });
  }

  async function fetchEventCategories(eventId) {
    return request(buildUrl(GET_EVENT_CATEGORIES_PATH, { id: eventId }), { method: "GET" });
  }

  async function fetchImageMetadata(eventId) {
    return request(buildUrl(GET_EVENT_IMAGE_METADATA_PATH, { eventId: eventId }), { method: "GET" });
  }

  function hasSignedUrl(url) {
    return /[?&]x-amz-signature=/i.test(String(url || ""));
  }

  function isLikelyPrivateS3Url(url) {
    return /amazonaws\.com/i.test(String(url || "")) && !hasSignedUrl(url);
  }

  function extractS3KeyFromUrl(url) {
    try {
      var parsed = new URL(url);
      var path = parsed.pathname.replace(/^\/+/, "");
      if (/\.s3[.-]/i.test(parsed.hostname) || /\.s3\.amazonaws\.com$/i.test(parsed.hostname)) {
        return decodeURIComponent(path);
      }
      if (/s3[.-].*amazonaws\.com$/i.test(parsed.hostname)) {
        var firstSlash = path.indexOf("/");
        return firstSlash >= 0 ? decodeURIComponent(path.slice(firstSlash + 1)) : "";
      }
      return "";
    } catch (error) {
      return "";
    }
  }

  function extractDocumentTail(doc, eventId) {
    var path = extractAssetPath(doc);
    if (!path) {
      return "";
    }

    if (/^https?:\/\//i.test(path)) {
      path = extractS3KeyFromUrl(path) || path;
    } else if (/^s3:\/\//i.test(path)) {
      var s3Parts = path.replace(/^s3:\/\//i, "").split("/");
      s3Parts.shift();
      path = s3Parts.join("/");
    }

    var expectedPrefix = "events/" + eventId + "/documents/";
    if (path.indexOf(expectedPrefix) === 0) {
      return path.slice(expectedPrefix.length);
    }

    var docsMarker = "/documents/";
    var markerIndex = path.indexOf(docsMarker);
    if (markerIndex >= 0) {
      return path.slice(markerIndex + docsMarker.length);
    }

    var slashIndex = path.lastIndexOf("/");
    return slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  }

  function pickDownloadUrl(data) {
    if (!data) {
      return "";
    }
    if (typeof data === "string" && /^https?:\/\//i.test(data)) {
      return data;
    }
    if (typeof data !== "object") {
      return "";
    }
    var candidates = [
      data.url,
      data.downloadUrl,
      data.presignedUrl,
      data.presignUrl,
      data.fileUrl,
      data.href,
      data.data && data.data.url,
      data.result && data.result.url
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = readText(candidates[i], "");
      if (/^https?:\/\//i.test(candidate)) {
        return candidate;
      }
    }
    return "";
  }

  async function fetchDocumentDownloadUrl(eventId, doc) {
    var tail = extractDocumentTail(doc, eventId);
    if (!tail) {
      throw new Error("No document key available.");
    }

    for (var i = 0; i < DOC_DOWNLOAD_PATH_CANDIDATES.length; i += 1) {
      var url = buildUrl(DOC_DOWNLOAD_PATH_CANDIDATES[i], { eventId: eventId, docKey: tail });
      try {
        var data = await request(url, { method: "GET" });
        var downloadUrl = pickDownloadUrl(data);
        if (downloadUrl) {
          return downloadUrl;
        }
      } catch (error) {
        continue;
      }
    }

    throw new Error("No signed document URL was returned by the API.");
  }

  async function forceDownload(url, fileName) {
    var response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new Error("Download request failed (" + response.status + ").");
    }
    var blob = await response.blob();
    var objectUrl = URL.createObjectURL(blob);
    try {
      var link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName || "download";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
      }, 4000);
    }
  }

  async function downloadDocument(eventId, doc) {
    var assetBases = [];
    var directUrl = resolveAssetUrl(doc, assetBases);
    var label = extractAssetLabel(doc, "document");
    if (/^https?:\/\//i.test(directUrl) && !isLikelyPrivateS3Url(directUrl)) {
      await forceDownload(directUrl, label);
      return { mode: "direct" };
    }
    var signedUrl = await fetchDocumentDownloadUrl(eventId, doc);
    await forceDownload(signedUrl, label);
    return { mode: "signed" };
  }

  function resolveUploadKey(presign, fallbackName, kind) {
    var key = presign.key || (presign.fields && presign.fields.key) || fallbackName;
    var explicitUrl = presign.publicUrl || presign.fileUrl || presign.objectUrl;
    if (explicitUrl && kind !== "document") {
      return explicitUrl;
    }

    var uploadUrl = presign.uploadUrl || presign.url || "";
    if (!/^https?:\/\//i.test(uploadUrl) || kind === "document") {
      return key;
    }

    var cleanUploadUrl = uploadUrl.split("?")[0].split("#")[0];
    if (presign.fields && presign.url && key) {
      return cleanUploadUrl.replace(/\/+$/, "") + "/" + encodePathSegments(key);
    }
    if (key && cleanUploadUrl.indexOf(key) !== -1) {
      return cleanUploadUrl;
    }
    return key;
  }

  async function uploadViaPut(file, presign) {
    var response = await fetch(presign.uploadUrl || presign.url, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file
    });
    if (!response.ok) {
      throw new Error("Upload failed (" + response.status + ")");
    }
  }

  async function uploadViaPost(file, presign) {
    var formData = new FormData();
    Object.entries(presign.fields || {}).forEach(function (entry) {
      formData.append(entry[0], entry[1]);
    });
    formData.append("file", file);

    var response = await fetch(presign.url, {
      method: "POST",
      body: formData
    });
    if (!response.ok) {
      throw new Error("Upload failed (" + response.status + ")");
    }
  }

  async function requestPresign(kind, eventId, file, imageKind) {
    var path = kind === "image" ? IMAGE_PRESIGN_PATH : DOC_PRESIGN_PATH;
    var body = {
      eventId: eventId,
      ext: extensionFromFilename(file.name) || (kind === "image" ? "jpg" : "pdf"),
      contentType: file.type || "application/octet-stream"
    };

    if (kind === "image") {
      body.kind = imageKind;
    } else {
      body.filename = file.name;
    }

    return request(buildUrl(path, { eventId: eventId }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  async function uploadAssets(eventId, imageFiles, documentFiles, onProgress) {
    var imageKeys = [];
    var docKeys = [];
    var total = (imageFiles || []).length + (documentFiles || []).length;
    var completed = 0;

    function notify(stage, detail) {
      if (typeof onProgress === "function") {
        onProgress({
          stage: stage,
          detail: detail,
          completed: completed,
          total: total
        });
      }
    }

    for (var i = 0; i < (imageFiles || []).length; i += 1) {
      var imageFile = imageFiles[i];
      var imageKind = i === 0 ? "hero" : "gallery";
      notify("presign-image", imageFile.name);
      var imagePresign = await requestPresign("image", eventId, imageFile, imageKind);
      notify("upload-image", imageFile.name);
      if (imagePresign.fields && imagePresign.url) {
        await uploadViaPost(imageFile, imagePresign);
      } else {
        await uploadViaPut(imageFile, imagePresign);
      }
      imageKeys.push(resolveUploadKey(imagePresign, imageFile.name, "image"));
      completed += 1;
      notify("uploaded-image", imageFile.name);
    }

    for (var j = 0; j < (documentFiles || []).length; j += 1) {
      var documentFile = documentFiles[j];
      notify("presign-document", documentFile.name);
      var docPresign = await requestPresign("document", eventId, documentFile);
      notify("upload-document", documentFile.name);
      if (docPresign.fields && docPresign.url) {
        await uploadViaPost(documentFile, docPresign);
      } else {
        await uploadViaPut(documentFile, docPresign);
      }
      docKeys.push(resolveUploadKey(docPresign, documentFile.name, "document"));
      completed += 1;
      notify("uploaded-document", documentFile.name);
    }

    return {
      imageKeys: imageKeys,
      documentKeys: docKeys
    };
  }

  async function createEvent(payload) {
    return request(buildUrl(CREATE_EVENT_PATH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function updateEvent(eventId, body) {
    return request(buildUrl(UPDATE_EVENT_PATH, { id: eventId }), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  async function cancelEvent(eventId) {
    return request(buildUrl(CANCEL_EVENT_PATH, { id: eventId }), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" })
    });
  }

  function getVenueConfig(venueName) {
    for (var i = 0; i < VENUE_LAYOUTS.length; i += 1) {
      if (VENUE_LAYOUTS[i].venueName === venueName) {
        return VENUE_LAYOUTS[i];
      }
    }
    return null;
  }

  function getLayoutConfig(venueName, layoutName) {
    var venueConfig = getVenueConfig(venueName);
    if (!venueConfig) {
      return null;
    }
    for (var i = 0; i < venueConfig.layouts.length; i += 1) {
      if (venueConfig.layouts[i].layoutName === layoutName) {
        return venueConfig.layouts[i];
      }
    }
    return null;
  }

  function createChip(text) {
    var chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = text;
    return chip;
  }

  function createEventCard(eventData, options) {
    var eventId = pickEventId(eventData);
    var card = document.createElement("article");
    var href = (options && options.href) || "event.html?id=" + encodeURIComponent(eventId || "");
    card.className = "event-card";

    var anchor = document.createElement("a");
    anchor.href = eventId ? href : "#";
    anchor.className = "event-card";
    anchor.setAttribute("aria-label", readText(eventData.event_name, "Event card"));

    var media = document.createElement("div");
    media.className = "event-media";
    var image = document.createElement("img");
    image.src = pickHero(eventData);
    image.alt = readText(eventData.event_name, "Event image");
    media.appendChild(image);

    var badge = document.createElement("div");
    badge.className = "event-media-badge";
    badge.textContent = toList(eventData.categories)[0] || "Campus Pick";
    media.appendChild(badge);

    var body = document.createElement("div");
    body.className = "event-body";

    var title = document.createElement("h3");
    title.className = "event-title";
    title.textContent = readText(eventData.event_name, "Untitled Event");
    body.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "event-meta";
    meta.innerHTML =
      "<span><span class='meta-strong'>" + escapeHtml(formatDateTime(eventData.date_time || eventData.start_date_time || eventData.start_time)) + "</span></span>" +
      "<span>" + escapeHtml(readText(eventData.location, "Location TBD")) + "</span>";
    body.appendChild(meta);

    var copy = document.createElement("p");
    copy.className = "event-copy";
    copy.textContent = truncateText(eventData.description, 110);
    body.appendChild(copy);

    var chipRow = document.createElement("div");
    chipRow.className = "chip-row";
    var categories = toList(eventData.categories);
    if (categories.length === 0) {
      categories = ["General"];
    }
    categories.slice(0, 3).forEach(function (category) {
      var tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = category;
      chipRow.appendChild(tag);
    });
    body.appendChild(chipRow);

    var footer = document.createElement("div");
    footer.className = "action-row";
    footer.style.justifyContent = "space-between";
    footer.style.alignItems = "center";

    var price = document.createElement("div");
    price.className = "price-block";
    price.innerHTML =
      "<span class='price-main'>" + escapeHtml(formatPriceSummary(eventData)) + "</span>" +
      "<span class='price-sub'>" + escapeHtml(readText(eventId, "ID unavailable")) + "</span>";
    footer.appendChild(price);

    var cta = document.createElement("span");
    cta.className = "button-ghost";
    cta.textContent = eventId ? "Open event" : "Preview";
    footer.appendChild(cta);
    body.appendChild(footer);

    anchor.appendChild(media);
    anchor.appendChild(body);
    return anchor;
  }

  function groupEventsByDay(items) {
    var grouped = {};
    (items || []).forEach(function (item) {
      var keySource = item.date_time || item.start_date_time || item.start_time;
      var keyDate = new Date(keySource);
      var key = Number.isNaN(keyDate.getTime()) ? "unknown" : keyDate.toISOString().slice(0, 10);
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(item);
    });

    return Object.keys(grouped).sort().map(function (key) {
      return {
        key: key,
        title: key === "unknown" ? "Date unavailable" : formatDayHeading(key),
        items: grouped[key].slice().sort(function (left, right) {
          return new Date(left.date_time || left.start_date_time || left.start_time).getTime() -
            new Date(right.date_time || right.start_date_time || right.start_time).getTime();
        })
      };
    });
  }

  function summarizeCategories(items) {
    var counts = {};
    (items || []).forEach(function (item) {
      toList(item.categories).forEach(function (category) {
        counts[category] = (counts[category] || 0) + 1;
      });
    });
    return Object.keys(counts).sort(function (left, right) {
      return counts[right] - counts[left];
    }).map(function (category) {
      return {
        category: category,
        count: counts[category]
      };
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  window.MockSite = {
    API_BASE: API_BASE,
    CATEGORIES: CATEGORIES,
    VENUE_LAYOUTS: VENUE_LAYOUTS,
    DEFAULT_PLACEHOLDER_IMAGE: DEFAULT_PLACEHOLDER_IMAGE,
    readText: readText,
    toList: toList,
    uniqueStrings: uniqueStrings,
    formatDateTime: formatDateTime,
    formatDayHeading: formatDayHeading,
    formatDateInput: formatDateInput,
    formatMoney: formatMoney,
    formatPriceSummary: formatPriceSummary,
    truncateText: truncateText,
    startOfToday: startOfToday,
    addDays: addDays,
    buildUrl: buildUrl,
    appendQueryParams: appendQueryParams,
    pickItems: pickItems,
    pickEventData: pickEventData,
    pickEventId: pickEventId,
    pickHero: pickHero,
    deriveAssetBases: deriveAssetBases,
    resolveAssetUrl: resolveAssetUrl,
    extractAssetPath: extractAssetPath,
    extractAssetLabel: extractAssetLabel,
    fetchUpcoming: fetchUpcoming,
    searchEvents: searchEvents,
    fetchByCategory: fetchByCategory,
    fetchByDate: fetchByDate,
    fetchEventById: fetchEventById,
    fetchEventCategories: fetchEventCategories,
    fetchImageMetadata: fetchImageMetadata,
    fetchDocumentDownloadUrl: fetchDocumentDownloadUrl,
    downloadDocument: downloadDocument,
    isLikelyPrivateS3Url: isLikelyPrivateS3Url,
    hasSignedUrl: hasSignedUrl,
    generateEventId: generateEventId,
    toApiDateTime: toApiDateTime,
    parseOptionalInt: parseOptionalInt,
    getVenueConfig: getVenueConfig,
    getLayoutConfig: getLayoutConfig,
    uploadAssets: uploadAssets,
    createEvent: createEvent,
    updateEvent: updateEvent,
    cancelEvent: cancelEvent,
    createChip: createChip,
    createEventCard: createEventCard,
    groupEventsByDay: groupEventsByDay,
    summarizeCategories: summarizeCategories,
    escapeHtml: escapeHtml
  };
}());

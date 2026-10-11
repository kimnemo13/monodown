/* monoDown — 자동 업데이트
 * GitHub 저장소의 version.json을 확인해 새 버전이면 파일을 내려받아 패널을 다시 불러온다.
 * - 최신 커밋 SHA로 raw 파일을 받으므로 GitHub CDN 캐시 때문에 옛 파일을 받는 일이 없다.
 * - bin/ (yt-dlp, ffmpeg, deno)은 건드리지 않는다.
 */
(function () {
  "use strict";
  var req = (window.cep_node && window.cep_node.require) || window.require;
  if (!req) return;
  var https = req("https"), fs = req("fs"), path = req("path");
  var IS_WIN = process.platform === "win32";

  function extensionRoot() {
    var p = decodeURI(window.__adobe_cep__.getSystemPath("extension"));
    p = IS_WIN ? p.replace(/^file:\/\/\//, "") : p.replace(/^file:\/\//, "");
    return path.normalize(p);
  }
  var ROOT = extensionRoot();
  var REPO_KEY = "monodown.repo", AUTO_KEY = "monodown.autoUpdate", BRANCH = "main";

  function readLocal() {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")); }
    catch (e) { return { version: "0.0.0", files: [] }; }
  }

  function getRepo() {
    var r = null;
    try { r = localStorage.getItem(REPO_KEY); } catch (e) {}
    return (r || readLocal().repo || "").trim();
  }
  function setRepo(r) {
    r = (r || "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
    try { localStorage.setItem(REPO_KEY, r); } catch (e) {}
    return r;
  }
  function isAuto() { try { return localStorage.getItem(AUTO_KEY) !== "0"; } catch (e) { return true; } }
  function setAuto(v) { try { localStorage.setItem(AUTO_KEY, v ? "1" : "0"); } catch (e) {} }

  function get(url, asJson, redirects) {
    redirects = redirects || 0;
    return new Promise(function (resolve, reject) {
      var r = https.get(url, { headers: { "User-Agent": "monoDown-Updater", "Accept": "application/vnd.github+json" } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          res.resume();
          return resolve(get(res.headers.location, asJson, redirects + 1));
        }
        var chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
          var buf = Buffer.concat(chunks);
          if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode + " (" + url.split("?")[0] + ")"));
          if (!asJson) return resolve(buf);
          try { resolve(JSON.parse(buf.toString("utf8"))); } catch (e) { reject(new Error("JSON 해석 실패")); }
        });
      });
      r.setTimeout(20000, function () { r.destroy(new Error("시간 초과")); });
      r.on("error", reject);
    });
  }

  function newer(a, b) { // a > b ?
    var x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0;
    }
    return false;
  }

  function safeRel(p) {
    if (typeof p !== "string" || !p || path.isAbsolute(p) || p.indexOf("..") !== -1) return false;
    if (/^bin[\\/]/.test(p)) return false;
    return true;
  }

  // 반환: {status: "none"|"updated"|"no-repo", version, needsRestart}
  function check(onMsg) {
    onMsg = onMsg || function () {};
    var repo = getRepo();
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return Promise.resolve({ status: "no-repo" });
    var local = readLocal();
    var sha;
    return get("https://api.github.com/repos/" + repo + "/commits/" + BRANCH, true)
      .then(function (c) {
        sha = c.sha;
        return get("https://raw.githubusercontent.com/" + repo + "/" + sha + "/version.json", true);
      })
      .then(function (remote) {
        if (!newer(remote.version, local.version)) return { status: "none", version: local.version };
        var files = (remote.files || []).filter(safeRel).filter(function (f) { return f !== "version.json"; });
        onMsg("새 버전 " + remote.version + " 받는 중… (0/" + files.length + ")");
        var got = {}, n = 0;
        // 전부 받은 뒤에 한꺼번에 쓴다 (중간에 실패하면 아무것도 안 바뀜)
        return files.reduce(function (p, f) {
          return p.then(function () {
            return get("https://raw.githubusercontent.com/" + repo + "/" + sha + "/" + f.split("/").map(encodeURIComponent).join("/"), false)
              .then(function (buf) { got[f] = buf; n++; onMsg("새 버전 " + remote.version + " 받는 중… (" + n + "/" + files.length + ")"); });
          });
        }, Promise.resolve()).then(function () {
          var needsRestart = false;
          Object.keys(got).forEach(function (f) {
            var dst = path.join(ROOT, f);
            if (f === "CSXS/manifest.xml") {
              try { if (!fs.readFileSync(dst).equals(got[f])) needsRestart = true; } catch (e) { needsRestart = true; }
            }
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.writeFileSync(dst, got[f]);
          });
          if (!IS_WIN) {
            ["install-mac.command"].forEach(function (f) { try { fs.chmodSync(path.join(ROOT, f), 493); } catch (e) {} });
          }
          remote.repo = remote.repo || repo;
          fs.writeFileSync(path.join(ROOT, "version.json"), JSON.stringify(remote, null, 2));
          return { status: "updated", version: remote.version, notes: remote.notes || "", needsRestart: needsRestart };
        });
      });
  }

  window.MDUpdater = {
    check: check, getRepo: getRepo, setRepo: setRepo, isAuto: isAuto, setAuto: setAuto,
    localVersion: function () { return readLocal().version; }
  };
})();

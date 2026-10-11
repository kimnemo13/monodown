/* monoDown — CEP 패널 로직 (macOS / Windows 공용) */
(function () {
  "use strict";

  // ---------- Node 모듈 ----------
  var nodeRequire = (window.cep_node && window.cep_node.require) || window.require;
  if (!nodeRequire) {
    document.getElementById("status").textContent = "Node.js가 비활성화되어 있습니다. manifest의 --enable-nodejs를 확인하세요.";
    return;
  }
  var cp = nodeRequire("child_process");
  var fs = nodeRequire("fs");
  var path = nodeRequire("path");
  var os = nodeRequire("os");

  var IS_WIN = process.platform === "win32";
  var EXE = IS_WIN ? ".exe" : "";
  var BIN_NAME = "00 monoDown"; // 프리미어 프로젝트 안의 빈 이름

  // ---------- 경로 ----------
  function extensionRoot() {
    var p = window.__adobe_cep__.getSystemPath("extension");
    p = decodeURI(p);
    p = IS_WIN ? p.replace(/^file:\/\/\//, "") : p.replace(/^file:\/\//, "");
    return path.normalize(p);
  }
  var ROOT = extensionRoot();
  var BIN_DIR = path.join(ROOT, "bin", IS_WIN ? "win" : "mac");

  // 번들 bin → Homebrew → PATH 순서로 찾는다
  var SEARCH_DIRS = [BIN_DIR];
  if (!IS_WIN) SEARCH_DIRS.push("/opt/homebrew/bin", "/usr/local/bin");
  (process.env.PATH || "").split(path.delimiter).forEach(function (d) { if (d) SEARCH_DIRS.push(d); });

  function findTool(name) {
    for (var i = 0; i < SEARCH_DIRS.length; i++) {
      var candidate = path.join(SEARCH_DIRS[i], name + EXE);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch (e) {}
    }
    return null;
  }

  var tools = {};
  function refreshTools() {
    tools.ytdlp = findTool("yt-dlp");
    tools.ffmpeg = findTool("ffmpeg");
    tools.deno = findTool("deno");
    var parts = [
      (tools.ytdlp ? "yt-dlp ✓" : "yt-dlp ✗"),
      (tools.ffmpeg ? "ffmpeg ✓" : "ffmpeg ✗"),
      (tools.deno ? "deno ✓" : "deno ✗")
    ];
    $("toolState").textContent = parts.join("  ");
  }

  // 쓰기 가능한 작업 폴더. 프리미어(CEP) 안에서는 현재 폴더가 읽기 전용인 "/"라서
  // yt-dlp가 임시 파일을 만들다 "Read-only file system" 오류가 난다.
  var WORK_DIR = path.join(os.tmpdir(), "monoDown");
  var CACHE_DIR = path.join(os.homedir(), IS_WIN ? "AppData\\Local\\monoDown\\cache" : "Library/Caches/monoDown");
  [WORK_DIR, CACHE_DIR].forEach(function (d) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} });

  // 자식 프로세스 환경: 번들 bin을 PATH 앞에 둬서 yt-dlp가 deno/ffmpeg를 찾게 한다
  function childEnv() {
    var env = Object.assign({}, process.env);
    var extra = [BIN_DIR];
    if (!IS_WIN) extra.push("/opt/homebrew/bin", "/usr/local/bin");
    env.PATH = extra.join(path.delimiter) + path.delimiter + (env.PATH || "");
    env.TMPDIR = env.TEMP = env.TMP = WORK_DIR;
    env.PYTHONIOENCODING = "utf-8";
    env.PYTHONUTF8 = "1";
    return env;
  }

  // ---------- DOM ----------
  function $(id) { return document.getElementById(id); }
  var el = {
    url: $("url"), btnInfo: $("btnInfo"), infoCard: $("infoCard"), thumb: $("thumb"),
    title: $("title"), meta: $("meta"), maxq: $("maxq"), outDir: $("outDir"),
    btnFolder: $("btnFolder"), btnStart: $("btnStart"), btnCancel: $("btnCancel"),
    fill: $("fill"), playhead: $("playhead"), status: $("status"), log: $("log"),
    btnUpdate: $("btnUpdate"), sdrOnly: $("sdrOnly"), keepSource: $("keepSource"),
    autoImport: $("autoImport")
  };

  function log(line) {
    el.log.textContent += line.replace(/\s+$/, "") + "\n";
    if (el.log.textContent.length > 60000) el.log.textContent = el.log.textContent.slice(-40000);
    el.log.scrollTop = el.log.scrollHeight;
  }
  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.className = "status" + (kind ? " " + kind : "");
  }
  function setProgress(pct, done) {
    pct = Math.max(0, Math.min(100, pct || 0));
    el.fill.style.width = pct + "%";
    el.playhead.style.left = "calc(" + pct + "% - 1px)";
    el.fill.classList.toggle("done", !!done);
  }
  function selectedMode() {
    var r = document.querySelector('input[name="mode"]:checked');
    return r ? r.value : "compat";
  }

  // ---------- ExtendScript 브리지 ----------
  function evalHost(script) {
    return new Promise(function (resolve) {
      window.__adobe_cep__.evalScript(script, function (res) { resolve(res); });
    });
  }

  // ---------- 저장 폴더 ----------
  var outDir = "";
  var PREF_KEY = "monodown.outDir";
  function setOutDir(p) {
    outDir = p;
    el.outDir.textContent = p;
    el.outDir.title = p;
    try { localStorage.setItem(PREF_KEY, p); } catch (e) {}
  }
  function initOutDir() {
    var saved = null;
    try { saved = localStorage.getItem(PREF_KEY); } catch (e) {}
    if (saved && fs.existsSync(saved)) return setOutDir(saved);
    evalHost("md_projectFolder()").then(function (res) {
      var p = res && res !== "EvalScript error." ? decodeURIComponent(res) : "";
      if (!p) p = path.join(os.homedir(), IS_WIN ? "Videos" : "Movies", "monoDown");
      setOutDir(p);
    });
  }
  el.btnFolder.addEventListener("click", function () {
    evalHost("md_pickFolder()").then(function (res) {
      if (res && res !== "EvalScript error.") setOutDir(decodeURIComponent(res));
    });
  });

  // ---------- 프로세스 실행 ----------
  var current = null; // 실행 중인 자식 프로세스
  var cancelled = false;

  function run(cmd, args, onLine) {
    return new Promise(function (resolve, reject) {
      log("$ " + path.basename(cmd) + " " + args.map(function (a) { return /\s/.test(a) ? '"' + a + '"' : a; }).join(" "));
      var cwd = (outDir && fs.existsSync(outDir)) ? outDir : WORK_DIR;
      var child = cp.spawn(cmd, args, { env: childEnv(), cwd: cwd, windowsHide: true });
      current = child;
      var out = "", err = "", bufOut = "", bufErr = "";
      function feed(chunk, isErr) {
        var s = chunk.toString("utf8");
        if (isErr) err += s; else out += s;
        var buf = (isErr ? bufErr : bufOut) + s;
        var lines = buf.split(/\r?\n|\r/);
        var rest = lines.pop();
        if (isErr) bufErr = rest; else bufOut = rest;
        lines.forEach(function (l) { if (l.trim() && onLine) onLine(l, isErr); });
      }
      child.stdout.on("data", function (c) { feed(c, false); });
      child.stderr.on("data", function (c) { feed(c, true); });
      child.on("error", function (e) { current = null; reject(e); });
      child.on("close", function (code) {
        current = null;
        if (cancelled) return reject(new Error("취소됨"));
        if (code === 0) resolve({ out: out, err: err });
        else reject(new Error(lastMeaningful(err) || ("종료 코드 " + code)));
      });
    });
  }
  function lastMeaningful(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return /ERROR|Error|error/.test(l); });
    return lines.length ? lines[lines.length - 1].trim() : "";
  }
  function killCurrent() {
    if (!current) return;
    try {
      if (IS_WIN) cp.spawn("taskkill", ["/pid", String(current.pid), "/T", "/F"], { windowsHide: true });
      else current.kill("SIGTERM");
    } catch (e) {}
  }

  // yt-dlp 공통 인자: 유튜브 서명 해독용 JS 런타임(deno) 위치를 명시
  function commonArgs() {
    var a = ["--no-warnings", "--encoding", "utf-8", "--cache-dir", CACHE_DIR];
    if (tools.deno) a.push("--js-runtimes", "deno:" + tools.deno);
    return a;
  }

  // ---------- 영상 정보 ----------
  var info = null;
  function fmtDuration(s) {
    if (!s) return "";
    s = Math.round(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
  }
  function summarizeFormats(fmts) {
    var best = null, bestAvc = null;
    (fmts || []).forEach(function (f) {
      if (!f.vcodec || f.vcodec === "none" || !f.height) return;
      if (!best || f.height > best.height || (f.height === best.height && (f.fps || 0) > (best.fps || 0))) best = f;
      if (/^avc1/.test(f.vcodec) && (!bestAvc || f.height > bestAvc.height)) bestAvc = f;
    });
    return { best: best, bestAvc: bestAvc };
  }
  function codecName(v) {
    if (!v) return "";
    if (/^avc1/.test(v)) return "H.264";
    if (/^vp0?9/.test(v)) return "VP9";
    if (/^av01/.test(v)) return "AV1";
    return v.split(".")[0];
  }

  function fetchInfo() {
    var url = el.url.value.trim();
    if (!url) { setStatus("URL을 입력하세요.", "err"); return Promise.reject(new Error("no url")); }
    if (!tools.ytdlp) { setStatus("yt-dlp를 찾을 수 없습니다. 설치 스크립트를 먼저 실행하세요.", "err"); return Promise.reject(new Error("no yt-dlp")); }
    setStatus("영상 정보를 불러오는 중…");
    el.btnInfo.disabled = true;
    return run(tools.ytdlp, ["-J", "--no-playlist"].concat(commonArgs(), [url])).then(function (r) {
      info = JSON.parse(r.out);
      var s = summarizeFormats(info.formats);
      el.thumb.src = info.thumbnail || "";
      el.title.textContent = info.title || "";
      el.meta.textContent = [info.uploader || info.channel || "", fmtDuration(info.duration)].filter(Boolean).join(" / ");
      var html = "";
      if (s.best) html += "최고 <b>" + s.best.height + "p" + (s.best.fps > 30 ? s.best.fps : "") + "</b> " + codecName(s.best.vcodec);
      if (s.bestAvc) html += "<br>H.264 최고 <b>" + s.bestAvc.height + "p</b>";
      el.maxq.innerHTML = html;
      el.infoCard.classList.remove("hidden");
      setStatus("준비 완료");
      return info;
    }).finally(function () { el.btnInfo.disabled = false; });
  }
  el.btnInfo.addEventListener("click", function () {
    cancelled = false;
    fetchInfo().catch(function (e) { if (e.message !== "no url" && e.message !== "no yt-dlp") setStatus("정보를 가져오지 못했습니다: " + e.message, "err"); });
  });
  el.url.addEventListener("keydown", function (e) { if (e.key === "Enter") el.btnInfo.click(); });

  // ---------- 다운로드 ----------
  function formatSelector(mode, sdrOnly) {
    if (mode === "compat") {
      // H.264 + AAC 우선, 없으면 가능한 최선
      return "bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[vcodec^=avc1]/bv*+ba/b";
    }
    var sdr = sdrOnly ? "[dynamic_range=SDR]" : "";
    return "bv*" + sdr + "+ba/bv*+ba/b";
  }

  function download(url, mode, extra) {
    var args = commonArgs().concat(extra || [], [
      "--retries", "10", "--fragment-retries", "10", "--extractor-retries", "3",
      "--no-playlist", "--newline", "--progress", "--windows-filenames",
      "-P", "temp:" + WORK_DIR,
      "-f", formatSelector(mode, el.sdrOnly.checked),
      "-S", "res,fps",
      "--merge-output-format", mode === "compat" ? "mp4" : "mkv",
      "-o", path.join(outDir, "%(title).120B [%(id)s].%(ext)s"),
      "--progress-template", "download:[PROG] %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
      "--print", "after_move:[FILE] %(filepath)s"
    ]);
    if (tools.ffmpeg) args.push("--ffmpeg-location", tools.ffmpeg);
    args.push(url);

    var stage = 0; // 영상 → 오디오 순으로 받으므로 두 구간으로 나눠 표시
    var lastPct = 0, filePath = null;
    return run(tools.ytdlp, args, function (line) {
      var m = line.match(/^\[PROG\]\s*([\d.]+)%\|([^|]*)\|(.*)$/);
      if (m) {
        var pct = parseFloat(m[1]);
        if (pct < lastPct - 50) stage++; // 새 스트림 시작
        lastPct = pct;
        var overall = stage === 0 ? pct * 0.85 : 85 + pct * 0.15;
        setProgress(mode === "compat" || mode === "original" ? overall : overall * 0.5);
        setStatus("다운로드 중 " + pct.toFixed(1) + "%  " + m[2].trim() + "  남은 시간 " + m[3].trim());
        return;
      }
      var f = line.match(/^\[FILE\]\s*(.+)$/);
      if (f) { filePath = f[1].trim(); return; }
      if (/\[Merger\]/.test(line)) setStatus("영상과 오디오를 합치는 중…");
      log(line);
    }).then(function () {
      if (!filePath || !fs.existsSync(filePath)) throw new Error("다운로드한 파일 경로를 확인하지 못했습니다");
      return filePath;
    });
  }

  function transcode(src, mode, duration) {
    if (!tools.ffmpeg) return Promise.reject(new Error("ffmpeg를 찾을 수 없습니다"));
    var base = src.replace(/\.[^.\\\/]+$/, "");
    var dst, codecArgs;
    if (mode === "prores") {
      dst = base + ".mov";
      codecArgs = ["-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0", "-pix_fmt", "yuv422p10le",
                   "-c:a", "pcm_s16le"];
    } else {
      dst = base + ".mp4";
      codecArgs = ["-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
                   "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart"];
    }
    var args = ["-hide_banner", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?"]
      .concat(codecArgs, ["-progress", "pipe:1", "-nostats", dst]);
    var label = mode === "prores" ? "ProRes" : "H.264";
    setStatus(label + "로 변환 중…");
    return run(tools.ffmpeg, args, function (line, isErr) {
      var m = line.match(/^out_time_(?:ms|us)=(\d+)/);
      if (m && duration) {
        var pct = (parseInt(m[1], 10) / 1e6) / duration * 100;
        setProgress(50 + Math.min(pct, 100) * 0.5);
        setStatus(label + "로 변환 중 " + Math.min(pct, 100).toFixed(1) + "%");
        return;
      }
      if (isErr) log(line);
    }).then(function () {
      if (!el.keepSource.checked) { try { fs.unlinkSync(src); } catch (e) { log("원본 삭제 실패: " + e.message); } }
      return dst;
    });
  }

  function importToProject(file) {
    var script = "md_importFile('" + encodeURIComponent(file) + "','" + encodeURIComponent(BIN_NAME) + "')";
    return evalHost(script).then(function (res) {
      if (res !== "OK") throw new Error(String(res).replace(/^ERR:/, ""));
    });
  }

  function setBusy(busy) {
    el.btnStart.disabled = busy;
    el.btnInfo.disabled = busy;
    el.btnUpdate.disabled = busy;
    el.btnCancel.disabled = !busy;
  }

  el.btnStart.addEventListener("click", function () {
    var url = el.url.value.trim();
    var mode = selectedMode();
    if (!url) return setStatus("URL을 입력하세요.", "err");
    if (!tools.ytdlp) return setStatus("yt-dlp를 찾을 수 없습니다. 설치 스크립트를 먼저 실행하세요.", "err");
    if (!tools.ffmpeg) return setStatus("ffmpeg를 찾을 수 없습니다. 영상·오디오 병합에 필요합니다.", "err");
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { return setStatus("저장 폴더를 만들 수 없습니다: " + e.message, "err"); }

    cancelled = false;
    setBusy(true);
    setProgress(0);
    el.log.textContent = "";

    var needInfo = (!info || (info.webpage_url !== url && info.original_url !== url)) ? fetchInfo() : Promise.resolve(info);
    var finalFile;
    needInfo
      .then(function (i) { return downloadWithRetry(url, mode).then(function (f) { return { file: f, duration: i && i.duration }; }); })
      .then(function (r) {
        if (mode === "prores" || mode === "h264") return transcode(r.file, mode, r.duration);
        return r.file;
      })
      .then(function (f) {
        finalFile = f;
        log("완료: " + f);
        if (!el.autoImport.checked) return;
        setStatus("프로젝트로 가져오는 중…");
        return importToProject(f);
      })
      .then(function () {
        setProgress(100, true);
        setStatus(el.autoImport.checked ? "완료 — '" + BIN_NAME + "' 빈에 추가했습니다" : "완료 — " + path.basename(finalFile), "ok");
      })
      .catch(function (e) {
        setProgress(0);
        setStatus(cancelled ? "취소했습니다." : "실패: " + e.message, cancelled ? "" : "err");
        log("오류: " + e.message);
      })
      .finally(function () { setBusy(false); });
  });

  el.btnCancel.addEventListener("click", function () {
    cancelled = true;
    killCurrent();
    setStatus("취소하는 중…");
  });

  // ---------- yt-dlp 자동 업데이트 (nightly) ----------
  // 유튜브가 자주 바뀌어서 안정판보다 nightly가 403 등의 수정이 훨씬 빨리 들어온다.
  var YTDLP_CHECK_KEY = "monodown.ytdlpChecked";
  var ytdlpUpdating = null; // 진행 중인 업데이트 Promise (다운로드는 이게 끝나길 기다린다)
  function bundledYtdlp() { return tools.ytdlp && tools.ytdlp.indexOf(BIN_DIR) === 0; }
  function updateYtdlp() {
    if (!bundledYtdlp()) return Promise.resolve(false); // Homebrew 등은 건드리지 않음
    if (ytdlpUpdating) return ytdlpUpdating;
    var changed = false;
    ytdlpUpdating = new Promise(function (resolve) {
      var child = cp.spawn(tools.ytdlp, ["--update-to", "nightly"], { env: childEnv(), cwd: WORK_DIR, windowsHide: true });
      var out = "";
      child.stdout.on("data", function (c) { out += c; });
      child.stderr.on("data", function (c) { out += c; });
      child.on("error", function () { resolve(false); });
      child.on("close", function (code) {
        changed = /Updated yt-dlp to/i.test(out);
        out.split(/\r?\n/).forEach(function (l) { if (l.trim()) log("[yt-dlp 업데이트] " + l.trim()); });
        try { localStorage.setItem(YTDLP_CHECK_KEY, String(Date.now())); } catch (e) {}
        resolve(code === 0 && changed);
      });
    });
    ytdlpUpdating.then(function () { ytdlpUpdating = null; });
    return ytdlpUpdating;
  }
  function autoUpdateYtdlp() {
    var last = 0;
    try { last = parseInt(localStorage.getItem(YTDLP_CHECK_KEY) || "0", 10); } catch (e) {}
    if (Date.now() - last < 6 * 3600 * 1000) return; // 6시간에 한 번
    updateYtdlp().then(function (changed) { if (changed) showUpdateBar("yt-dlp를 최신 버전으로 업데이트했습니다."); });
  }

  // 403(접근 거부) 같은 유튜브 차단 오류일 때 단계별로 다시 시도
  function isBlocked(msg) { return /403|Forbidden|Sign in to confirm|not a bot|Requested format is not available|PO Token/i.test(msg || ""); }
  var FALLBACK_CLIENTS = "youtube:player_client=default,tv_simply,web_embedded,visionos";
  function downloadWithRetry(url, mode) {
    var wait = ytdlpUpdating || Promise.resolve();
    return wait.then(function () { return download(url, mode); }).catch(function (e) {
      if (cancelled || !isBlocked(e.message)) throw e;
      log("유튜브가 요청을 거부함. 다시 시도합니다 (1/3)");
      setStatus("유튜브가 거부해서 다시 시도하는 중… (1/3)");
      return download(url, mode).catch(function (e2) {
        if (cancelled || !isBlocked(e2.message)) throw e2;
        setStatus("yt-dlp를 최신 버전으로 올리고 다시 시도하는 중… (2/3)");
        return updateYtdlp().then(function () { return download(url, mode); }).catch(function (e3) {
          if (cancelled || !isBlocked(e3.message)) throw e3;
          setStatus("다른 접속 방식으로 다시 시도하는 중… (3/3)");
          return download(url, mode, ["--extractor-args", FALLBACK_CLIENTS]).catch(function (e4) {
            if (cancelled) throw e4;
            throw new Error("유튜브가 다운로드를 막고 있습니다. 잠시 후 다시 시도하세요. (" + e4.message + ")");
          });
        });
      });
    });
  }

  el.btnUpdate.addEventListener("click", function () {
    if (!tools.ytdlp) return setStatus("yt-dlp를 찾을 수 없습니다.", "err");
    if (tools.ytdlp.indexOf(BIN_DIR) !== 0) {
      return setStatus("Homebrew 등으로 설치된 yt-dlp는 해당 패키지 매니저로 업데이트하세요.", "err");
    }
    setBusy(true);
    setStatus("yt-dlp 업데이트 중…");
    updateYtdlp()
      .then(function (changed) { setStatus(changed ? "yt-dlp를 최신 버전으로 업데이트했습니다." : "yt-dlp가 이미 최신 버전입니다.", "ok"); })
      .finally(function () { setBusy(false); });
  });

  // ---------- 자동 업데이트 ----------
  var upd = window.MDUpdater;
  var updBar = $("updateBar"), repoInput = $("repo"), autoBox = $("autoUpdate");
  function showUpdateBar(text, isErr, persist) {
    updBar.textContent = text;
    updBar.className = "update-bar" + (isErr ? " err" : "");
    clearTimeout(showUpdateBar.t);
    if (!persist) showUpdateBar.t = setTimeout(function () { updBar.classList.add("hidden"); }, 5000);
  }
  function checkUpdate(manual) {
    if (!upd) return;
    if (el.btnStart.disabled) { if (manual) showUpdateBar("다운로드가 끝난 뒤에 확인하세요.", true); return; }
    upd.check(function (msg) { showUpdateBar(msg, false, true); }).then(function (r) {
      if (r.status === "no-repo") {
        if (manual) { $("settings").open = true; showUpdateBar("업데이트 설정에 GitHub 저장소를 먼저 입력하세요.", true); }
        return;
      }
      if (r.status === "none") { if (manual) showUpdateBar("최신 버전입니다 (v" + r.version + ")"); return; }
      try { sessionStorage.setItem("monodown.justUpdated", JSON.stringify(r)); } catch (e) {}
      if (r.needsRestart) {
        showUpdateBar("v" + r.version + " 설치 완료. 이번 업데이트는 프리미어를 재시작해야 적용됩니다.", false, true);
      } else {
        showUpdateBar("v" + r.version + " 설치 완료. 패널을 다시 불러옵니다…", false, true);
        setTimeout(function () { location.reload(); }, 800);
      }
    }).catch(function (e) {
      if (manual) showUpdateBar("업데이트 확인 실패: " + e.message, true);
      log("업데이트 확인 실패: " + e.message);
    });
  }
  if (upd) {
    $("version").textContent = "v" + upd.localVersion();
    repoInput.value = upd.getRepo();
    autoBox.checked = upd.isAuto();
    autoBox.addEventListener("change", function () { upd.setAuto(autoBox.checked); });
    $("btnRepoSave").addEventListener("click", function () {
      repoInput.value = upd.setRepo(repoInput.value);
      checkUpdate(true);
    });
    $("btnCheckUpdate").addEventListener("click", function () { checkUpdate(true); });
    var just = null;
    try { just = JSON.parse(sessionStorage.getItem("monodown.justUpdated") || "null"); } catch (e) {}
    if (just) {
      try { sessionStorage.removeItem("monodown.justUpdated"); } catch (e) {}
      showUpdateBar("v" + just.version + "로 업데이트됨" + (just.notes ? ": " + just.notes : ""));
    } else if (upd.isAuto()) {
      setTimeout(function () { checkUpdate(false); }, 1500);
    }
  }

  // 패널을 다시 불러올 때도 최신 host.jsx가 적용되도록 매번 다시 읽는다
  evalHost('$.evalFile("' + path.join(ROOT, "jsx", "host.jsx").replace(/\\/g, "/") + '")');

  // ---------- 시작 ----------
  refreshTools();
  initOutDir();
  setTimeout(autoUpdateYtdlp, 800);
  if (!tools.ytdlp || !tools.ffmpeg) {
    setStatus("필요한 도구가 없습니다. README의 설치 스크립트를 실행하세요.", "err");
  }
})();

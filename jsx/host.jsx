// ExtendScript (Premiere Pro 호스트 측)
// 경로는 패널에서 encodeURIComponent로 넘겨 유니코드/역슬래시 문제를 피한다.

function md_pickFolder() {
    var f = Folder.selectDialog("다운로드 폴더 선택");
    return f ? encodeURIComponent(f.fsName) : "";
}

function md_projectFolder() {
    try {
        if (app.project && app.project.path) {
            var f = new File(app.project.path);
            return encodeURIComponent(f.parent.fsName);
        }
    } catch (e) {}
    return "";
}

function md_findOrCreateBin(root, name) {
    for (var i = 0; i < root.children.numItems; i++) {
        var c = root.children[i];
        if (c && c.name === name && c.type === ProjectItemType.BIN) return c;
    }
    var created = root.createBin(name);
    if (created) return created;
    // 구버전 호환: createBin이 반환값을 주지 않는 경우
    for (var j = 0; j < root.children.numItems; j++) {
        var d = root.children[j];
        if (d && d.name === name && d.type === ProjectItemType.BIN) return d;
    }
    return root;
}

function md_importFile(encPath, encBinName) {
    try {
        if (!app.project) return "ERR:열린 프로젝트가 없습니다";
        var path = decodeURIComponent(encPath);
        var binName = decodeURIComponent(encBinName);
        var f = new File(path);
        if (!f.exists) return "ERR:파일을 찾을 수 없습니다: " + path;
        var bin = md_findOrCreateBin(app.project.rootItem, binName);
        var ok = app.project.importFiles([f.fsName], true, bin, false);
        return ok ? "OK" : "ERR:임포트에 실패했습니다";
    } catch (e) {
        return "ERR:" + e.toString();
    }
}

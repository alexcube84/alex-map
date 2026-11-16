(function () {
  'use strict';
  var PY = 3.305785; // 1평 = 3.305785㎡
  var $ = function (id) { return document.getElementById(id); };
  var key = window.VWORLD_KEY || '';
  var map = L.map('map').setView([37.5172, 127.0473], 13);
  var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  var bases = { '기본(OSM)': osm }, overlays = {};
  if (key) {
    var vw = function (layer, ext) {
      return L.tileLayer('https://api.vworld.kr/req/wmts/1.0.0/' + key + '/' + layer + '/{z}/{y}/{x}.' + ext, { maxZoom: 19, attribution: '© VWorld' });
    };
    bases = { '일반': vw('Base', 'png'), '위성': vw('Satellite', 'jpeg'), '기본(OSM)': osm };
    overlays['지적편집도'] = L.tileLayer.wms('https://api.vworld.kr/req/wms', {
      key: key, domain: location.hostname, layers: 'lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun',
      styles: 'lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun', format: 'image/png', transparent: true, version: '1.3.0', minZoom: 16, maxZoom: 19
    });
    bases['일반'].addTo(map);
  } else { osm.addTo(map); }
  L.control.layers(bases, overlays).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  var cluster = L.markerClusterGroup({ disableClusteringAtZoom: 17, chunkedLoading: true }).addTo(map);
  var meta = null, rows = [], shown = [], center = null, circle = null, pin = null, F = {};

  function rec(r) {
    return { ym: r[0], day: r[1], name: r[2], dong: r[3], jibun: r[4], area: r[5], price: r[6], floor: r[7],
      built: r[8], cancel: r[9], lat: r[10], lng: r[11], approx: r[12], use: r[13] || '', area2: r[14],
      unit: r[5] && r[6] ? r[6] / r[5] : null, unit2: r[14] && r[6] ? r[6] / r[14] : null };
  }
  function won(v) { // 만원 단위 → 읽기 쉬운 표기
    if (v == null) return '-';
    var eok = Math.floor(v / 10000), rest = Math.round(v % 10000);
    return (eok ? eok + '억' : '') + (rest ? (eok ? ' ' : '') + rest.toLocaleString() + '만' : (eok ? '' : '0'));
  }
  function unitText(d) {
    if (d.unit == null) return '-';
    return Math.round(d.unit).toLocaleString() + '만/㎡ · ' + Math.round(d.unit * PY).toLocaleString() + '만/평';
  }
  function areaText(d) { // 유형별 면적 이름(전용·건물·연면적·거래면적)과 대지면적
    var a = (F.area_label || '면적') + ' ' + (d.area == null ? '-' : d.area + '㎡');
    if (F.area2_label && d.area2 != null) a += ' · ' + F.area2_label + ' ' + d.area2 + '㎡';
    return a;
  }
  function floorText(d) { return d.floor == null ? '' : ' · ' + d.floor + '층'; }
  function dateText(d) { return d.ym.slice(0, 4) + '.' + d.ym.slice(4) + (d.day ? '.' + ('0' + d.day).slice(-2) : ''); }
  function val(id) { var v = $(id).value.trim(); return v === '' ? null : Number(v); }
  function between(x, lo, hi) { return (lo == null || (x != null && x >= lo)) && (hi == null || (x != null && x <= hi)); }

  function apply() {
    var ym1 = $('f-ym1').value.trim(), ym2 = $('f-ym2').value.trim(), q = $('f-q').value.trim();
    var rad = Number($('f-rad').value), inView = $('f-view').checked, b = map.getBounds();
    shown = rows.filter(function (d) {
      if (!$('f-cancel').checked && d.cancel) return false;
      if (ym1 && d.ym < ym1) return false;
      if (ym2 && d.ym > ym2) return false;
      if (!between(d.area, val('f-a1'), val('f-a2'))) return false;
      if (!between(d.floor, val('f-fl1'), val('f-fl2'))) return false;
      if (!between(d.price, val('f-p1'), val('f-p2'))) return false;
      if (!between(d.built, val('f-b1'), val('f-b2'))) return false;
      if (q && (d.name + ' ' + d.dong + ' ' + d.use).indexOf(q) < 0) return false;
      if (rad && center) { if (d.lat == null || map.distance(center, [d.lat, d.lng]) > rad) return false; }
      if (inView) { if (d.lat == null || !b.contains([d.lat, d.lng])) return false; }
      return true;
    });
    var s = $('f-sort').value;
    shown.sort(function (a, b2) {
      if (s === 'date') return (b2.ym + ('0' + (b2.day || 0)).slice(-2)).localeCompare(a.ym + ('0' + (a.day || 0)).slice(-2));
      var x = a.unit == null ? -1 : a.unit, y = b2.unit == null ? -1 : b2.unit;
      return s === 'unit' ? y - x : (x < 0 ? 1 : y < 0 ? -1 : x - y);
    });
    draw();
  }

  function draw() {
    cluster.clearLayers();
    var ms = [];
    shown.forEach(function (d) {
      if (d.lat == null) return;
      var m = L.circleMarker([d.lat, d.lng], { radius: 6, weight: 1, color: '#fff', fillColor: d.cancel ? '#b02a37' : d.approx ? '#c77700' : '#1f6fd0', fillOpacity: .9 });
      m.bindPopup('<b>' + (d.name || d.dong) + '</b>' + (d.use && d.use !== d.name ? ' <span style="color:#5c6875">' + d.use + '</span>' : '') +
        '<br>' + d.dong + ' ' + (d.jibun || '') + (d.approx ? ' <i>(위치 추정: 법정동)</i>' : '') +
        '<br>' + dateText(d) + floorText(d) + '<br>' + areaText(d) +
        '<br><b>' + won(d.price) + '</b> (' + F.area_label + ' 기준 ' + unitText(d) + ')' +
        (d.unit2 != null ? '<br>' + F.area2_label + ' 기준 ' + Math.round(d.unit2 * PY).toLocaleString() + '만/평' : '') +
        (d.cancel ? '<br><b style="color:#b02a37">해제된 거래</b>' : ''));
      d._m = m; ms.push(m);
    });
    cluster.addLayers(ms);
    var us = shown.map(function (d) { return d.unit; }).filter(function (u) { return u != null; }).sort(function (a, b) { return a - b; });
    var avg = us.length ? us.reduce(function (a, b) { return a + b; }, 0) / us.length : null;
    var med = us.length ? (us.length % 2 ? us[(us.length - 1) / 2] : (us[us.length / 2 - 1] + us[us.length / 2]) / 2) : null;
    var noLoc = shown.filter(function (d) { return d.lat == null; }).length;
    $('sum').innerHTML = '<b>' + shown.length.toLocaleString() + '건</b>' +
      (avg == null ? '' : ' · 평균 ' + Math.round(avg * PY).toLocaleString() + '만/평 · 중위 ' + Math.round(med * PY).toLocaleString() + '만/평') +
      (noLoc ? '<br><span style="color:#7a4b00">좌표 없는 거래 ' + noLoc + '건은 목록에만 표시됩니다.</span>' : '');
    $('list').innerHTML = shown.slice(0, 500).map(function (d, i) {
      return '<div class="it" data-i="' + i + '"><b>' + (d.name || d.dong) + '</b>' +
        (d.cancel ? '<span class="tag c">해제</span>' : '') + (d.approx ? '<span class="tag">위치 추정</span>' : '') +
        '<br>' + won(d.price) + floorText(d) + ' · ' + areaText(d) +
        '<div class="sub">' + dateText(d) + ' · ' + d.dong + ' ' + (d.jibun || '') + (d.use && d.use !== d.name ? ' · ' + d.use : '') + ' · ' + unitText(d) + '</div></div>';
    }).join('') + (shown.length > 500 ? '<div class="it sub">목록은 500건까지 표시합니다. 엑셀 저장에는 전부 들어갑니다.</div>' : '');
  }

  $('list').addEventListener('click', function (e) {
    var el = e.target.closest('.it'); if (!el || el.dataset.i == null) return;
    var d = shown[Number(el.dataset.i)]; if (!d || !d._m) return;
    cluster.zoomToShowLayer(d._m, function () { d._m.openPopup(); });
  });

  map.on('click', function (e) { // 반경 검색 중심점 지정
    if (!Number($('f-rad').value)) return;
    center = e.latlng; ring(); apply();
  });
  function ring() {
    if (circle) { map.removeLayer(circle); circle = null; }
    if (pin) { map.removeLayer(pin); pin = null; }
    var rad = Number($('f-rad').value);
    if (rad && center) {
      circle = L.circle(center, { radius: rad, color: '#d0471f', weight: 2, fillOpacity: .05, interactive: false }).addTo(map);
      pin = L.circleMarker(center, { radius: 4, color: '#d0471f', fillOpacity: 1, interactive: false }).addTo(map);
    }
  }
  map.on('moveend', function () { if ($('f-view').checked) apply(); });

  ['f-ym1', 'f-ym2', 'f-a1', 'f-a2', 'f-fl1', 'f-fl2', 'f-p1', 'f-p2', 'f-b1', 'f-b2', 'f-q'].forEach(function (id) { $(id).addEventListener('input', apply); });
  ['f-cancel', 'f-view', 'f-sort'].forEach(function (id) { $(id).addEventListener('change', apply); });
  $('f-rad').addEventListener('change', function () {
    if (Number(this.value) && !center) $('sum').innerHTML = '지도에서 중심점을 클릭하세요.';
    ring(); apply();
  });
  $('b-reset').addEventListener('click', function () {
    document.querySelectorAll('#filters input').forEach(function (i) { if (i.type === 'checkbox') i.checked = false; else i.value = ''; });
    $('f-rad').value = '0'; center = null; ring(); apply();
  });
  $('b-xlsx').addEventListener('click', function () {
    var out = shown.map(function (d) {
      var o = { 유형: F.label, 계약일: dateText(d), '명칭·용도': d.name, 구분: d.use, 법정동: d.dong, 지번: d.jibun };
      o[(F.area_label || '면적') + '(㎡)'] = d.area;
      if (F.area2_label) o[F.area2_label + '(㎡)'] = d.area2;
      o['거래금액(만원)'] = d.price; o.층 = d.floor; o.건축연도 = d.built;
      o['단가(만원/㎡)'] = d.unit == null ? null : Math.round(d.unit);
      o['단가(만원/평)'] = d.unit == null ? null : Math.round(d.unit * PY);
      if (F.area2_label) o[F.area2_label + ' 단가(만원/평)'] = d.unit2 == null ? null : Math.round(d.unit2 * PY);
      o.해제여부 = d.cancel ? '해제' : ''; o.위치 = d.lat == null ? '좌표 없음' : d.approx ? '추정(법정동)' : '지번';
      return o;
    });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), '실거래');
    XLSX.writeFile(wb, '실거래_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  });

  function load(i) {
    var f = meta.files[i]; F = f;
    fetch('data/' + f.type + '/' + f.region + '.json').then(function (r) { return r.json(); }).then(function (j) {
      rows = j.rows.map(rec);
      var pts = rows.filter(function (d) { return d.lat != null; }).map(function (d) { return [d.lat, d.lng]; });
      if (pts.length) map.fitBounds(pts, { padding: [20, 20] });
      apply();
    });
  }
  fetch('data/meta.json', { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('no data'); return r.json();
  }).then(function (m) {
    meta = m;
    $('upd').innerHTML = '최종 갱신 ' + m.updated + ' · 출처: 국토교통부 실거래가 공개시스템' +
      ((m.errors || []).length ? '<br><span style="color:#b02a37">수집 실패: ' + m.errors.join(' / ') + '</span>' : '');
    $('f-file').innerHTML = m.files.map(function (f, i) { return '<option value="' + i + '">' + f.label + ' · ' + f.name + ' (' + f.count.toLocaleString() + '건)</option>'; }).join('');
    $('f-file').addEventListener('change', function () { load(Number(this.value)); });
    if (m.files.length) load(0);
  }).catch(function () {
    $('upd').textContent = '아직 수집된 자료가 없습니다. GitHub Actions에서 수집을 한 번 실행하세요.';
  });
})();

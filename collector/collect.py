"""국토부 실거래가 수집기 (표준 라이브러리만 사용).

환경변수: MOLIT_KEY(공공데이터포털 인증키), VWORLD_KEY(지오코더용, 없으면 좌표 생략)
출력: site/data/<type>/<시군구코드>.json, site/data/meta.json, collector/geocache.json
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "collector/config.json").read_text(encoding="utf-8"))
DATA = ROOT / "site/data"
CACHE_PATH = ROOT / "collector/geocache.json"
COLS = ["ym", "day", "name", "dong", "jibun", "area", "price", "floor", "built", "cancel", "lat", "lng", "approx", "use", "area2"]


def http_get(url, params, retries=3):
    full = url + "?" + urllib.parse.urlencode(params)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(full, headers={"User-Agent": "realdeal-map/0.1"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:  # 네트워크 오류는 잠시 쉬고 재시도
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"요청 실패: {url} ({last})")


def month_list(n, today=None):
    today = today or dt.date.today()
    y, m, out = today.year, today.month, []
    for _ in range(n):
        out.append(f"{y}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out  # 최신월부터


def parse_items(xml_bytes):
    root = ET.fromstring(xml_bytes)
    code = (root.findtext(".//resultCode") or "").strip()
    if code not in ("000", "00"):
        msg = root.findtext(".//resultMsg") or root.findtext(".//returnAuthMsg") or xml_bytes[:200].decode("utf-8", "replace")
        raise RuntimeError(f"API 오류 {code}: {msg}")
    total = int(root.findtext(".//totalCount") or 0)
    items = [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]
    return total, items


def fetch_month(t, region, ym, key, fetch=http_get):
    rows, page = [], 1
    while True:
        raw = fetch(t["url"], {"serviceKey": key, "LAWD_CD": region, "DEAL_YMD": ym, "pageNo": page, "numOfRows": 1000})
        sample = ROOT / f"collector/raw_{t['id']}.xml"
        if page == 1 and not sample.exists():
            sample.write_bytes(raw)  # 유형별 필드명 확인용 원본 1건
        total, items = parse_items(raw)
        rows += items
        if len(rows) >= total or not items:
            return rows
        page += 1


def first(item, fields):
    for f in fields:
        if item.get(f):
            return item[f]
    return ""


def num(s, cast=float):
    try:
        return cast(str(s).replace(",", "").strip())
    except ValueError:
        return None


def geocode(addr, key, cache, fetch=http_get):
    if addr in cache:
        return cache[addr]
    if not key:
        return None
    try:
        params = {"service": "address", "request": "getCoord", "version": "2.0", "crs": "epsg:4326",
                  "format": "json", "type": "PARCEL", "refine": "true", "address": addr, "key": key}
        domain = os.environ.get("VWORLD_DOMAIN", "").strip()
        if domain:  # VWorld는 키에 등록한 서비스 도메인을 함께 보내야 받아준다
            params["domain"] = domain
        raw = fetch("https://api.vworld.kr/req/address", params)
        res = json.loads(raw)["response"]
        if res.get("status") == "OK":
            p = res["result"]["point"]
            cache[addr] = [round(float(p["y"]), 6), round(float(p["x"]), 6)]
        elif res.get("status") == "NOT_FOUND":
            cache[addr] = None  # 없는 주소는 다시 묻지 않음
        else:
            raise RuntimeError(json.dumps(res.get("error", res), ensure_ascii=False))
    except Exception as e:
        print(f"::warning::지오코딩 실패 {addr}: {e}")
        return None
    time.sleep(0.05)
    return cache[addr]


def dong_point(region_name, dong, key, cache, fetch=http_get):
    """지번이 가려진 거래용 법정동 대표 좌표 (VWorld 행정구역 검색)."""
    ck = f"동:{region_name} {dong}"
    if ck in cache:
        return cache[ck]
    if not key:
        return None
    pt = None
    try:
        params = {"service": "search", "request": "search", "version": "2.0", "crs": "EPSG:4326", "size": "5",
                  "page": "1", "query": f"{region_name} {dong}", "type": "district", "category": "L4",
                  "format": "json", "errorformat": "json", "key": key}
        domain = os.environ.get("VWORLD_DOMAIN", "").strip()
        if domain:
            params["domain"] = domain
        res = json.loads(fetch("https://api.vworld.kr/req/search", params))["response"]
        items = (res.get("result") or {}).get("items") or []
        hit = next((x for x in items if str(x.get("title", "")).endswith(dong)), items[0] if items else None)
        if hit and hit.get("point"):
            pt = [round(float(hit["point"]["y"]), 6), round(float(hit["point"]["x"]), 6)]
    except Exception as e:
        print(f"::warning::법정동 좌표 실패 {region_name} {dong}: {e}")
        return None
    cache[ck] = pt
    return pt


def normalize(item, t, region_name, ym, vkey, cache, fetch=http_get):
    dong, jibun = item.get("umdNm", ""), item.get("jibun", "")
    exact = bool(jibun) and "*" not in jibun
    pt = geocode(f"{region_name} {dong} {jibun}", vkey, cache, fetch) if exact else None
    approx = 0
    if pt is None:  # 지번이 가려졌거나 못 찾으면 법정동 위치로 대체
        pt = dong_point(region_name, dong, vkey, cache, fetch) if dong else None
        approx = 1
    return [ym, num(item.get("dealDay"), int), first(item, t["name_fields"]), dong, jibun,
            num(first(item, t["area_fields"])), num(item.get("dealAmount"), int),
            num(item.get("floor"), int), num(item.get("buildYear"), int),
            1 if item.get("cdealType") == "O" else 0,
            pt[0] if pt else None, pt[1] if pt else None, approx if pt else None,
            " ".join(dict.fromkeys(item[f] for f in t.get("use_fields", []) if item.get(f))),
            num(first(item, t.get("area2_fields", [])))]


def main(fetch=http_get):
    key = urllib.parse.unquote(os.environ.get("MOLIT_KEY", "").strip())
    vkey = os.environ.get("VWORLD_KEY", "").strip()
    if not key:
        sys.exit("MOLIT_KEY 환경변수가 없습니다.")
    cache = json.loads(CACHE_PATH.read_text(encoding="utf-8")) if CACHE_PATH.exists() else {}
    months = month_list(CFG["months"])
    meta = {"updated": dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m-%d %H:%M"),
            "cols": COLS, "files": [], "errors": []}
    ok = 0
    for t in CFG["types"]:
        for r in CFG["regions"]:
            path = DATA / t["id"] / f"{r['code']}.json"
            old = json.loads(path.read_text(encoding="utf-8"))["rows"] if path.exists() else []
            have = {row[0] for row in old}
            # 처음이면 전 기간, 이후엔 최근 몇 달과 빠진 달만 다시 받는다
            todo = [m for m in months if m not in have or m in months[:CFG["refresh_months"]]]
            fresh, done = [], set()
            try:
                for ym in todo:
                    for it in fetch_month(t, r["code"], ym, key, fetch):
                        fresh.append(normalize(it, t, r["name"], ym, vkey, cache, fetch))
                    done.add(ym)
            except Exception as e:
                meta["errors"].append(f"{t['label']} {r['name']}: {e}")
                print(f"::error::{t['label']} {r['name']}: {e}")
            rows = [x for x in old if x[0] in months and x[0] not in done] + fresh
            rows.sort(key=lambda x: (x[0], x[1] or 0), reverse=True)
            if done or old:
                path.parent.mkdir(parents=True, exist_ok=True)
                body = json.dumps({"rows": rows}, ensure_ascii=False, separators=(",", ":"))
                path.write_text(body, encoding="utf-8")
                located = sum(1 for x in rows if x[10] is not None)
                meta["files"].append({"type": t["id"], "label": t["label"], "region": r["code"], "name": r["name"],
                                      "area_label": t.get("area_label", "면적"), "area2_label": t.get("area2_label", ""),
                                      "count": len(rows), "located": located,
                                      "approx": sum(1 for x in rows if x[12] == 1),
                                      "bytes": len(body.encode("utf-8"))})
                ok += 1 if done else 0
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if ok == 0:
        sys.exit("새로 받은 자료가 없습니다. 기존 자료를 유지합니다: " + "; ".join(meta["errors"]))
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    for e in meta["errors"]:
        print(f"::warning::{e}")
    for f in meta["files"]:
        print(f"{f['label']} {f['name']}: {f['count']}건, 좌표 {f['located']}건(추정 {f['approx']}), {f['bytes']/max(f['count'],1):.0f}바이트/건")


if __name__ == "__main__":
    main()

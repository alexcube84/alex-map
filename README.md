# 실거래가 지도 (시제품)

공개 데이터(국토교통부 실거래가)만으로 만드는 개인용 지도입니다.
시제품 범위: 서울 강남구 · 오피스텔 매매 · 최근 24개월.

## 구성

- `collector/collect.py` 국토부 API 수집 → VWorld 좌표 부여 → `site/data/`에 저장
- `collector/config.json` 수집 대상(유형·지역·기간). 여기만 고치면 범위가 넓어집니다
- `.github/workflows/update.yml` 매주 월요일 03:00 자동 수집 후 GitHub Pages 배포
- `site/` 지도 화면 (`config.js`에 VWorld 키 입력)

## 처음 한 번 설정

1. GitHub에 **공개** 저장소를 만들고 이 폴더 내용을 그대로 올립니다(`.github` 폴더 포함).
2. 공공데이터포털(data.go.kr)에서 「국토교통부_오피스텔 매매 실거래가 자료」를 활용신청하고 인증키를 받습니다.
3. VWorld(vworld.kr)에서 인증키를 발급합니다. 서비스 URL은 `https://<깃허브아이디>.github.io`로 등록합니다.
4. 저장소 Settings → Secrets and variables → Actions에 `MOLIT_KEY`, `VWORLD_KEY`를 등록합니다.
   같은 화면의 Variables 탭에 `VWORLD_DOMAIN`(VWorld에 등록한 서비스 도메인, 예: `아이디.github.io`)도 등록합니다.
5. `site/config.js`의 따옴표 안에 VWorld 키를 넣습니다.
6. 저장소 Settings → Pages → Source를 **GitHub Actions**로 바꿉니다.
7. Actions 탭 → 「실거래가 갱신 및 배포」 → Run workflow를 누릅니다.
8. 끝나면 `https://<깃허브아이디>.github.io/<저장소이름>/`에서 열립니다.

## 첫 실행에서 확인할 것

- 수집 단계 로그의 마지막 줄: 건수, 좌표가 붙은 건수, 건당 바이트
- `collector/raw_sample.xml`: API 원본 응답 1건(필드명 확인용)
- 좌표가 0건이면 VWorld 키가 서버 호출에서 거부된 것이니 로그의 경고 문구를 확인합니다

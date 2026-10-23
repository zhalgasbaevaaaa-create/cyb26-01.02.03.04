# Орналастыру нұсқаулығы (GAME HUB PROJECT AUDITOR)

## 1. Неліктен серверлік орта қажет?

Платформа **сервер жағында Playwright + Chromium** іске қосады (студент сайттарын нақты браузерде тексеру үшін). Сондықтан тек статикалық хостинг (мысалы, GitHub Pages, Firebase Hosting frontend үшін) **жеткіліксіз** — Node.js процесті, браузер бинарлық файлдарын және файл жүйесін қолдайтын орта керек (VPS, Render, Railway, Fly.io, Docker).

## 2. Docker арқылы орналастыру (ұсынылады)

```bash
docker build -t game-hub-auditor .
docker run -d --name auditor \
  -p 8787:8787 \
  -e ADMIN_TOKEN="ӨТЕ_КҮШТІ_КЕЗДЕЙСОҚ_КІЛТ" \
  -e ALLOW_LOCALHOST_FOR_TESTS=0 \
  -v auditor-data:/app/data \
  game-hub-auditor
```

`-v auditor-data:/app/data` — дерекқор, есептер мен скриншоттар контейнер жаңартылғанда сақталады.

## 2.1. Render.com арқылы орналастыру (расталған, нақты жұмыс істейді)

Жүйе **нақты түрде** Render.com-ға (тегін тариф) орналастырылып, тексерілді:
**https://game-hub-project-auditor.onrender.com**

Қадамдар (Dashboard арқылы қолмен):

1. https://dashboard.render.com → **New** → **Blueprint** → GitHub репозиторийін қосыңыз (`projecttime`) → Render реподағы `render.yaml`-ды автоматты табады.
2. `render.yaml`-дағы әдепкі `plan: starter` + тұрақты диск — **ТӨЛЕМДІ талап етеді** (картасыз 402 қатесі шығады, API арқылы да, Dashboard арқылы да). Тегін тестілеу үшін блюпринтті қолданбай, қолмен **New → Web Service** жасап, «env: Docker», «Plan: Free», дискісіз орнатыңыз (төменде API мысалы да осылай).
3. Айнымалылар: `ADMIN_TOKEN` (Render өзі «Generate» арқылы жасай алады), `ALLOW_LOCALHOST_FOR_TESTS=0`, `PORT=8787`.
4. Deploy аяқталған соң Render берген URL бойынша `/api/system/info` ашылатынын тексеріңіз.

API арқылы (автоматтандыру үшін, Render API кілті керек):

```bash
curl -X POST https://api.render.com/v1/services \
  -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "type": "web_service",
    "name": "game-hub-project-auditor",
    "ownerId": "<GET /v1/owners арқылы алыңыз>",
    "repo": "https://github.com/zhalgasbaevaaaa-create/projecttime",
    "branch": "main",
    "serviceDetails": {
      "env": "docker", "plan": "free", "region": "oregon",
      "envSpecificDetails": { "dockerfilePath": "./Dockerfile", "dockerContext": "." }
    },
    "envVars": [
      { "key": "ADMIN_TOKEN", "generateValue": true },
      { "key": "ALLOW_LOCALHOST_FOR_TESTS", "value": "0" },
      { "key": "PORT", "value": "8787" }
    ]
  }'
```

⚠️ **Тегін тарифтің шектеуі (расталған):** диск тіркелмегендіктен, дерекқор (`data/db.json`) мен есептер/дәлелдемелер контейнер **әр қайта іске қосылғанда/жаңа деплойда жоғалады** (эфемерлі файл жүйесі), әрі қызмет 15 минут белсенсіздіктен кейін ұйықтайды (бірінші сұраныс ~30–50 сек.). Нақты оқу процесінде деректерді сақтау қажет болса — `https://dashboard.render.com/billing` бетінде төлем картасын қосып, `render.yaml`-дағы `plan: starter` + `disk` конфигурациясын қолданыңыз (сонда диск `/app/data`-ны тұрақты сақтайды).

**Ескерту (түзетілген ақаулар, болашақта қайталанбас үшін):** Dockerfile-дегі `FROM mcr.microsoft.com/playwright:...` нұсқасы әрқашан `server/package.json`-дағы `playwright` npm нұсқасымен **дәл сәйкес** болуы керек (екеуі сәйкессіз болса, браузер контейнерде табылмайды). PDF есебінің қазақша қаріптері (`server/assets/fonts/DejaVuSans*.ttf`) репозиторийге салынған — олар ОС-тің жүйелік қаріптеріне тәуелді емес, сондықтан кез келген Docker base image-де жұмыс істейді.

## 3. VPS-ке қолмен орналастыру

```bash
# Тәуелділіктер (Debian/Ubuntu)
sudo apt-get update && sudo apt-get install -y nodejs npm
git clone <репозиторий> && cd game-hub-auditor
npm install
npx playwright install chromium --with-deps   # браузер + жүйелік тәуелділіктер
cp .env.example .env && nano .env             # ADMIN_TOKEN-ды өзгертіңіз
npm run build -w client
npm run start -w server                       # немесе pm2: pm2 start "npm run start -w server" --name auditor
```

Кері прокси (nginx) ұсынылады — HTTPS-ті ол береді:

```nginx
server {
  listen 443 ssl;
  server_name auditor.example.kz;
  # ssl_certificate ... (Let's Encrypt)
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    client_max_body_size 2m;
  }
}
```

## 4. `.env` параметрлері

| Параметр | Міндетті | Сипаттама |
|---|---|---|
| `PORT` | жоқ | Сервер порты (әдепкі 8787) |
| `ADMIN_TOKEN` | **иә** | Жүйеге кіру кілті. Күшті кездейсоқ мән: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DATA_DIR`, `EVIDENCE_DIR` | жоқ | Дерекқор/дәлелдер каталогы (әдепкі `./data`) |
| `MAX_CONCURRENT_JOBS` | жоқ | Бір уақыттағы тексерулер саны (әдепкі 1) |
| `JOB_TIMEOUT_MS` | жоқ | Бір тексерудің максималды уақыты (әдепкі 10 мин) |
| `NAV_TIMEOUT_MS` | жоқ | Бет жүктеу таймауты (әдепкі 30 сек) |
| `MAX_NETWORK_REQUESTS` | жоқ | Бір тексерудегі сұраныс шегі (әдепкі 400) |
| `ALLOW_LOCALHOST_FOR_TESTS` | жоқ | **Өндірісте 0!** Тек fixture сынақтары үшін 1 |
| `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON` | жоқ | Firebase қосылса (төменде) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | жоқ | Google OAuth қосылса |

## 5. Дерекқор

**Әдепкі: JSON файл** (`data/db.json`) — бір серверлі орналастыру үшін жеткілікті, қосымша баптау қажет емес. Барлық жазу операциялары атомарлы (уақытша файл + rename).

**Firebase Firestore (опция):**
1. Firebase консолында жоба жасаңыз → Firestore-ды қосыңыз.
2. Service Account кілтін (JSON) алыңыз.
3. `.env`-ке жазыңыз: `FIREBASE_PROJECT_ID=...`, `FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`.
4. `firebase/firestore.rules` файлын Firestore ережелеріне көшіріңіз.

Ескерту: қазіргі нұсқада Firestore адаптері конфигурация деңгейінде дайын, бірақ нақты Firebase жобасы болмағандықтан **тестіленбеген** — қосқаннан кейін деректерді оқу/жазуды тексеріңіз.

## 6. Google OAuth (опция)

Ағымдағы кіру жүйесі — әкімші кілті (Bearer токен). Google OAuth қосу үшін:
1. Google Cloud Console → OAuth 2.0 Client ID жасаңыз.
2. Redirect URI: `https://<домен>/api/auth/google/callback`.
3. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` мәндерін `.env`-ке жазыңыз.

Ескерту: OAuth ағынының серверлік бөлігі конфигурацияланған, бірақ нақты Google тіркелгісіз **тестіленбеген**.

## 7. Жауаптар кілті (тарихи дәлдікті автоматты тексеру)

`data/answer_key.json` файлын жасаңыз (үлгі: `data/answer_key.example.json`):

```json
[
  { "question": "Қазақ хандығы қай жылы құрылды?", "answer": "1465" },
  { "question": "«Жеті жарғы» заңдар жинағын қабылдаған хан", "answer": "Тәуке хан" }
]
```

Кілт болмаса, тарихи дәлдік критерийі «Тексерілмеді» болады және мазмұн оқытушының қолмен тексеруіне ұсынылады (бұл — әдейі жасалған адал шектеу).

## 8. Өндірістік тексеру тізімі

- [ ] `ALLOW_LOCALHOST_FOR_TESTS=0`
- [ ] `ADMIN_TOKEN` ауыстырылған (әдепкі мән емес)
- [ ] HTTPS қосылған (кері прокси немесе платформа)
- [ ] `data/` каталогы тұрақты дискте (volume)
- [ ] Сынақ: жарамды сайт, қолжетімсіз сайт, жарамсыз URL, `http://169.254.169.254` (бұғатталуы керек)
- [ ] PDF/CSV жүктеу жұмыс істейді
- [ ] `.env` файлы репозиторийде жоқ (`.gitignore`-де бар)

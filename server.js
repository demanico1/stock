const express = require("express");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const Papa = require("papaparse");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const app = express();
const PORT = process.env.PORT || 10000;

const SPREADSHEET_ID = "1e03ZfswiWVtWoyyPK_RzmNi4orNWtp0Mdy_Ol0iwma4";
const BASE_URL = "https://stock-ja4e.onrender.com";

// ✅ Google Auth 공통 함수
async function getAuthClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return await auth.getClient();
}

// ✅ Sheets API로 실시간 데이터 가져오기 (딜레이 없음)
async function getLiveSheetData(gid) {
  const client = await getAuthClient();
  const sheets = google.sheets({ version: "v4", auth: client });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets.find(s => String(s.properties.sheetId) === String(gid));
  if (!sheet) throw new Error("시트를 찾을 수 없습니다.");
  const sheetName = sheet.properties.title;
  const data = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
  });
  const rows = data.data.values || [];
  const headers = rows[0];
  return rows.slice(1)
    .map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] || ""])))
    .filter(row => row["뉴스 제목"] || row["대표 뉴스 제목"]);
}

// ✅ CSV export로 데이터 가져오기 (캐시 있음 - 웹페이지용)
async function getCsvSheetData(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`;
  const response = await fetch(url);
  const csv = await response.text();
  const parsed = Papa.parse(csv, { header: true });
  return parsed.data.filter(row => row["뉴스 제목"] || row["대표 뉴스 제목"]);
}

// ✅ 오늘 날짜 시트 찾기 공통 함수
async function getTodaySheets() {
  const client = await getAuthClient();
  const sheets = google.sheets({ version: "v4", auth: client });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const date = String(today.getDate()).padStart(2, '0');
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const weekday = weekdays[today.getDay()];
  const datePattern = `${month}.${date}`;
  const datePatternWithDay = `${month}.${date}(${weekday})`;
  const allSheets = meta.data.sheets.map(s => ({
    name: s.properties.title,
    gid: s.properties.sheetId,
  }));
  const hotSheet = allSheets.find(s =>
    s.name.toLowerCase().includes('hot') && s.name.includes(datePatternWithDay)
  );
  const dbSheet = allSheets.find(s =>
    s.name.toLowerCase().includes('db') && s.name.includes(datePattern)
  );
  return { hotSheet, dbSheet, datePatternWithDay };
}

// ✅ 키워드 TOP 추출 함수
function extractTopKeywords(data, topN = 10) {
  const keywords = {};
  const stopwords = ['의', '을', '를', '이', '가', '은', '는', '에', '와', '과', '로', '으로', '에서', '으로부터'];
  data.forEach(row => {
    const title = row["뉴스 제목"] || row["대표 뉴스 제목"] || "";
    const words = title.split(/[\s\[\]「」『』()（）…·,，。.!?!?]+/)
      .filter(w => w.length >= 2 && !stopwords.includes(w));
    words.forEach(word => {
      keywords[word] = (keywords[word] || 0) + 1;
    });
  });
  return Object.entries(keywords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([keyword, count]) => ({ keyword, count }));
}

// ✅ 검색 필터 공통 함수
function filterByKeyword(data, keyword) {
  const keywords = keyword.split(",").map(k => k.trim().toLowerCase());
  return data.filter(row => {
    const title = (row["뉴스 제목"] || row["대표 뉴스 제목"] || "").toLowerCase();
    const stock = (row["종목명"] || "").toLowerCase();
    const channel = (row["채널명"] || "").toLowerCase();
    return keywords.every(k => title.includes(k) || stock.includes(k) || channel.includes(k));
  });
}

// ✅ digest 생성 공통 함수
function buildDigest(data) {
  const timeSlots = {};
  data.forEach(row => {
    const time = row["시간"] || row["최신 뉴스 시간"] || "";
    const hour = time.substring(11, 13);
    if (hour) timeSlots[hour] = (timeSlots[hour] || 0) + 1;
  });
  const channels = {};
  data.forEach(row => {
    const ch = row["채널명"] || "";
    if (ch) channels[ch] = (channels[ch] || 0) + 1;
  });
  const topChannels = Object.entries(channels)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([channel, count]) => ({ channel, count }));
  const stocks = {};
  data.forEach(row => {
    const stock = row["종목명"] || "";
    if (stock && stock !== "-") {
      stock.split(",").forEach(s => {
        const trimmed = s.trim();
        if (trimmed) stocks[trimmed] = (stocks[trimmed] || 0) + 1;
      });
    }
  });
  const topStocks = Object.entries(stocks)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([stock, count]) => ({ stock, count }));
  return {
    총건수: data.length,
    시간대별: timeSlots,
    채널TOP10: topChannels,
    종목TOP10: topStocks,
    키워드TOP10: extractTopKeywords(data),
  };
}

// ===================================
// 정적 파일 & 기본 라우트
// ===================================

app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "index.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("파일을 불러올 수 없습니다.");
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });
});

// ===================================
// 기존 엔드포인트
// ===================================

// 시트 목록 조회
app.get("/sheets", async (req, res) => {
  try {
    const client = await getAuthClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const result = meta.data.sheets.map(s => ({
      name: s.properties.title,
      gid: s.properties.sheetId,
      grouped: /(HOT|채널|이슈)/.test(s.properties.title),
    }));
    res.json(result);
  } catch (error) {
    console.error("시트 목록 불러오기 실패:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 특정 시트 조회 (CSV 캐시 방식 - 웹페이지용)
app.get("/sheet/:gid", async (req, res) => {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${req.params.gid}`;
    const response = await fetch(url);
    const csv = await response.text();
    const parsed = Papa.parse(csv, { header: true });
    res.json(parsed.data);
  } catch (error) {
    console.error("시트 데이터 가져오기 실패:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ✅ /today — live URL 반환 (핵심 수정!)
app.get("/today", async (req, res) => {
  try {
    const { hotSheet, dbSheet, datePatternWithDay } = await getTodaySheets();
    res.json({
      date: datePatternWithDay,
      hot: hotSheet ? `${BASE_URL}/live/${hotSheet.gid}` : null,
      db: dbSheet ? `${BASE_URL}/live/${dbSheet.gid}` : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================================
// 캐시 버전 엔드포인트 (웹페이지용)
// ===================================

app.get("/count/:gid", async (req, res) => {
  try {
    const data = await getCsvSheetData(req.params.gid);
    res.json({ gid: req.params.gid, count: data.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/latest/:gid", async (req, res) => {
  try {
    const n = parseInt(req.query.n) || 20;
    const data = await getCsvSheetData(req.params.gid);
    res.json({ count: data.length, data: data.slice(0, n) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/search/:gid", async (req, res) => {
  try {
    const keyword = req.query.keyword || "";
    if (!keyword) return res.status(400).json({ error: "keyword 파라미터가 필요합니다." });
    const data = await getCsvSheetData(req.params.gid);
    const results = filterByKeyword(data, keyword);
    res.json({ keyword, count: results.length, data: results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/digest/:gid", async (req, res) => {
  try {
    const data = await getCsvSheetData(req.params.gid);
    res.json(buildDigest(data));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/timeline/:gid", async (req, res) => {
  try {
    const keyword = req.query.keyword || "";
    if (!keyword) return res.status(400).json({ error: "keyword 파라미터가 필요합니다." });
    const data = await getCsvSheetData(req.params.gid);
    const filtered = filterByKeyword(data, keyword);
    const timeline = {};
    filtered.forEach(row => {
      const time = row["시간"] || row["최신 뉴스 시간"] || "";
      const hour = time.substring(11, 13);
      if (hour) timeline[hour] = (timeline[hour] || 0) + 1;
    });
    res.json({ keyword, count: filtered.length, timeline, data: filtered });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/channels/:gid", async (req, res) => {
  try {
    const data = await getCsvSheetData(req.params.gid);
    const channels = {};
    data.forEach(row => {
      const ch = row["채널명"] || "";
      if (ch) channels[ch] = (channels[ch] || 0) + 1;
    });
    const result = Object.entries(channels)
      .sort((a, b) => b[1] - a[1])
      .map(([channel, count]) => ({ channel, count }));
    res.json({ total: data.length, channels: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/stocks/:gid", async (req, res) => {
  try {
    const data = await getCsvSheetData(req.params.gid);
    const stocks = {};
    data.forEach(row => {
      const stock = row["종목명"] || "";
      if (stock && stock !== "-") {
        stock.split(",").forEach(s => {
          const trimmed = s.trim();
          if (trimmed) stocks[trimmed] = (stocks[trimmed] || 0) + 1;
        });
      }
    });
    const result = Object.entries(stocks)
      .sort((a, b) => b[1] - a[1])
      .map(([stock, count]) => ({ stock, count }));
    res.json({ total: data.length, stocks: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/compare/:gid", async (req, res) => {
  try {
    const k1 = (req.query.keyword1 || "").toLowerCase();
    const k2 = (req.query.keyword2 || "").toLowerCase();
    if (!k1 || !k2) return res.status(400).json({ error: "keyword1, keyword2 파라미터가 필요합니다." });
    const data = await getCsvSheetData(req.params.gid);
    const r1 = filterByKeyword(data, k1);
    const r2 = filterByKeyword(data, k2);
    res.json({
      [k1]: { count: r1.length, data: r1 },
      [k2]: { count: r2.length, data: r2 },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/hot-keywords/:gid", async (req, res) => {
  try {
    const n = parseInt(req.query.n) || 20;
    const data = await getCsvSheetData(req.params.gid);
    res.json({ total: data.length, keywords: extractTopKeywords(data, n) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================================
// 실시간(Live) 엔드포인트
// 순서 중요! /live/:gid 는 맨 마지막!
// ===================================

app.get("/live/today", async (req, res) => {
  try {
    const { hotSheet, dbSheet, datePatternWithDay } = await getTodaySheets();
    res.json({
      date: datePatternWithDay,
      hot: hotSheet ? { gid: hotSheet.gid, url: `${BASE_URL}/live/${hotSheet.gid}` } : null,
      db: dbSheet ? { gid: dbSheet.gid, url: `${BASE_URL}/live/${dbSheet.gid}` } : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/live/count/:gid", async (req, res) => {
  try {
    const data = await getLiveSheetData(req.params.gid);
    res.json({ gid: req.params.gid, count: data.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/live/latest/:gid", async (req, res) => {
  try {
    const n = parseInt(req.query.n) || 20;
    const data = await getLiveSheetData(req.params.gid);
    res.json({ count: data.length, data: data.slice(0, n) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/live/search/:gid", async (req, res) => {
  try {
    const keyword = req.query.keyword || "";
    if (!keyword) return res.status(400).json({ error: "keyword 파라미터가 필요합니다." });
    const data = await getLiveSheetData(req.params.gid);
    const results = filterByKeyword(data, keyword);
    res.json({ keyword, count: results.length, data: results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/live/digest/:gid", async (req, res) => {
  try {
    const data = await getLiveSheetData(req.params.gid);
    res.json(buildDigest(data));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/live/timeline/:gid", async (req, res) => {
  try {
    const keyword = req.query.keyword || "";
    if (!keyword) return res.status(400).json({ error: "keyword 파라미터가 필요합니다." });
    const data = await getLiveSheetData(req.params.gid);
    const filtered = filterByKeyword(data, keyword);
    const timeline = {};
    filtered.forEach(row => {
      const time = row["시간"] || row["최신 뉴스 시간"] || "";
      const hour = time.substring(11, 13);
      if (hour) timeline[hour] = (timeline[hour] || 0) + 1;
    });
    res.json({ keyword, count: filtered.length, timeline, data: filtered });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/live/channels/:gid", async (req, res) => {
  try {
    const data = await getLiveSheetData(req.params.gid);
    const channels = {};
    data.forEach(row => {
      const ch = row["채널명"] || "";
      if (ch) channels[ch] = (channels[ch] || 0) + 1;
    });
    const result = Object.entries(channels)
      .sort((a, b) => b[1] - a[1])
      .map(([channel, count]) => ({ channel, count }));
    res.json({ total: data.length, channels: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/live/stocks/:gid", async (req, res) => {
  try {
    const data = await getLiveSheetData(req.params.gid);
    const stocks = {};
    data.forEach(row => {
      const stock = row["종목명"] || "";
      if (stock && stock !== "-") {
        stock.split(",").forEach(s => {
          const trimmed = s.trim();
          if (trimmed) stocks[trimmed] = (stocks[trimmed] || 0) + 1;
        });
      }
    });
    const result = Object.entries(stocks)
      .sort((a, b) => b[1] - a[1])
      .map(([stock, count]) => ({ stock, count }));
    res.json({ total: data.length, stocks: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/live/hot-keywords/:gid", async (req, res) => {
  try {
    const n = parseInt(req.query.n) || 20;
    const data = await getLiveSheetData(req.params.gid);
    res.json({ total: data.length, keywords: extractTopKeywords(data, n) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/live/compare/:gid", async (req, res) => {
  try {
    const k1 = (req.query.keyword1 || "").toLowerCase();
    const k2 = (req.query.keyword2 || "").toLowerCase();
    if (!k1 || !k2) return res.status(400).json({ error: "keyword1, keyword2 파라미터가 필요합니다." });
    const data = await getLiveSheetData(req.params.gid);
    const r1 = filterByKeyword(data, k1);
    const r2 = filterByKeyword(data, k2);
    res.json({
      [k1]: { count: r1.length, data: r1 },
      [k2]: { count: r2.length, data: r2 },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ /live/:gid 는 맨 마지막!
app.get("/live/:gid", async (req, res) => {
  try {
    const data = await getLiveSheetData(req.params.gid);
    res.json({ count: data.length, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===================================
// 서버 실행
// ===================================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

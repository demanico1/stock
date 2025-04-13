const express = require("express");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "index.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) {
      res.status(500).send("파일을 불러올 수 없습니다.");
    } else {
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    }
  });
});

app.get("/sheets", async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const spreadsheetId = "1e03ZfswiWVtWoyyPK_RzmNi4orNWtp0Mdy_Ol0iwma4";
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const result = meta.data.sheets.map((s) => ({
      name: s.properties.title,
      gid: s.properties.sheetId,
      grouped: /(HOT|채널|이슈)/.test(s.properties.title),
    }));
    res.json(result);
  } catch (error) {
    console.error("시트 목록 불러오기 실패:", error.message);
    res.status(500).send("시트 불러오기 실패");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

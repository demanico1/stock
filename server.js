import express from "express";
import { google } from "googleapis";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

app.get("/sheets", async (req, res) => {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const spreadsheetId = "1e03ZfswiWVtWoyyPK_RzmNi4orNWtp0Mdy_Ol0iwma4";
  const response = await sheets.spreadsheets.get({ spreadsheetId });

  const result = response.data.sheets.map((sheet) => ({
    name: sheet.properties.title,
    gid: sheet.properties.sheetId,
  }));
  res.json(result);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

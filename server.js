app.get('/sheets', async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const spreadsheetId = "1e03ZfswiWVtWoyyPK_RzmNi4orNWtp0Mdy_Ol0iwma4";
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const result = meta.data.sheets.map(s => ({
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

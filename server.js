const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// 정적 파일 제공 (index.html 포함)
app.use(express.static(path.join(__dirname, '.')));

// 기본 라우트 처리
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
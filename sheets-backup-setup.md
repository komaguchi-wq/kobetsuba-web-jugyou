# Google Sheets バックアップ設定手順（コベツバ学習）

## 1. Google Sheets を作成

新しいスプレッドシートを作成する（名前は「コベツバ バックアップ」など）。

## 2. Apps Script を設定

スプレッドシートを開き、メニューから「拡張機能 → Apps Script」を選択。
以下のコードを貼り付けて保存する。

```javascript
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // ユーザーごとのシートを取得または作成
    let sheet = ss.getSheetByName(data.user);
    if (!sheet) {
      sheet = ss.insertSheet(data.user);
      sheet.appendRow(["timestamp", "key", "attempts", "correct", "accuracy", "firstRikai", "currentRikai"]);
    }

    // 既存データをクリアして最新を書き込み
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).clear();
    }

    let row = 2;
    for (const key in data.data) {
      const record = data.data[key];
      const accuracy = record.attempts > 0
        ? Math.round((record.correct / record.attempts) * 100) + "%"
        : "---";
      sheet.getRange(row, 1, 1, 7).setValues([[
        data.timestamp,
        key,
        record.attempts || 0,
        record.correct || 0,
        accuracy,
        record.firstRikai || "",
        record.currentRikai || ""
      ]]);
      row++;
    }

    return ContentService.createTextOutput(
      JSON.stringify({ status: "ok" })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    const user = e.parameter.user;
    if (!user) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: "error", message: "user parameter required" })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(user);
    if (!sheet || sheet.getLastRow() <= 1) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: "ok", data: {} })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
    const data = {};
    for (const row of rows) {
      const key = row[1];
      data[key] = {
        attempts: row[2],
        correct: row[3],
        firstRikai: row[5] || null,
        currentRikai: row[6] || null
      };
    }

    return ContentService.createTextOutput(
      JSON.stringify({ status: "ok", data })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
```

## 3. ウェブアプリとしてデプロイ

1. 「デプロイ → 新しいデプロイ」
2. 種類: 「ウェブアプリ」
3. 実行するユーザー: 「自分」
4. アクセスできるユーザー: 「全員」
5. デプロイして URL をコピー

## 4. アプリに URL を設定

アプリの⚙️ボタンから設定画面を開き、デプロイURLを貼り付けて「保存」。

## データ構造

スプレッドシートには各ユーザーのシートが作られ、以下の列で記録される:

| timestamp | key | attempts | correct | accuracy | firstRikai | currentRikai |
|-----------|-----|----------|---------|----------|------------|--------------|
| 2026-03-16T... | grade1/test01/point01-q1 | 3 | 2 | 67% | maru | sankaku |
| 2026-03-16T... | grade1/test01/point01-q2 | 1 | 1 | 100% | maru | maru |

- key: `{gradeId}/{unitId}/{questionId}` 形式
- firstRikai / currentRikai: `maru`（○）, `sankaku`（△）, `batsu`（×）, 空欄（未設定）

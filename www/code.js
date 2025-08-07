// Τελικός Google Apps Script Backend για Europcar (παραλαβή + ζημιά + logging + multilingual email) ΒΕΛΤΙΣΤΟΠΟΙΗΜΕΝΟΣ
const MASTER_FOLDER_ID = '1n3h6NXEiChUZI5OThl0d-Ea2SnPJ9G4U';
const LOG_SHEET_ID = '12VfnP2BgbsUMOHIZrZsj3rVGXqjcCD4gCxc4rvH0F18';
const NOTIFY_EMAIL = 'konfos@europcargreece.com';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Unified Form')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function submitForm(data) {
  return doPost({ postData: { contents: JSON.stringify(data) } });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const { type, irn, email, language, files } = data;
    if (!irn || !files?.length) return errorResponse("IRN και φωτογραφίες είναι υποχρεωτικά.");

    const lang = language === 'en' ? 'en' : 'el';
    const now = new Date();
    const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    const folderName = `${sanitize(irn)}_${type}_${timestamp}`;
    const parentFolder = DriveApp.getFolderById(MASTER_FOLDER_ID);
    const userFolder = parentFolder.createFolder(folderName);

    const blobs = files.map((f, i) => {
      const base64 = f.data.split(',')[1];
      const contentType = f.data.match(/^data:(image\/[a-zA-Z]+);base64,/)[1] || MimeType.JPEG;
      return Utilities.newBlob(Utilities.base64Decode(base64), contentType, f.name || `${irn}_${i + 1}.jpg`);
    });
    blobs.forEach(blob => userFolder.createFile(blob));

    const metadata = [
      `IRN: ${irn}`,
      `Τύπος: ${type}`,
      `Ημ/νία: ${timestamp}`,
      `Φωτογραφίες: ${blobs.length}`
    ];
    if (type === 'pickup') {
      metadata.push(
        `Email: ${email}`,
        `Πινακίδα: ${sanitize(data.plate)}`,
        `Τοποθεσία: ${sanitize(data.location)}`,
        `Ημ. Παραλαβής: ${sanitize(data.pickupDate)}`,
        `Χιλιόμετρα: ${sanitize(data.km)}`
      );
    } else {
      metadata.push(
        `Email: ${email}`,
        `Τοποθεσία: ${sanitize(data.location)}`,
        `Ημ. Συμβάντος: ${sanitize(data.damageDate || data.incidentDate)}`,
        `Περιγραφή: ${sanitize(data.description)}`
      );
    }
    userFolder.createFile('metadata.txt', metadata.join('\n'));

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: `Νέα Υποβολή Europcar (${type}) - IRN: ${irn}`,
      body: metadata.join('\n') + `\n\n📁 ${userFolder.getUrl()}`
    });

    logToSheet(data, userFolder.getUrl());
    sendLocalizedConfirmation(data, userFolder.getUrl());

    Utilities.sleep(300);
    return ContentService.createTextOutput(JSON.stringify({ success: true, folderUrl: userFolder.getUrl() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return errorResponse(err.message);
  }
}

function sanitize(input) {
  if (!input || typeof input !== 'string') return '';
  return input.replace(/[<>"'&]/g, '');
}

function errorResponse(msg) {
  return ContentService.createTextOutput(JSON.stringify({ error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

function logToSheet(data, folderUrl) {
  try {
    const sheet = SpreadsheetApp.openById(LOG_SHEET_ID);
    let logSheet = sheet.getSheetByName('Υποβολές') || sheet.insertSheet('Υποβολές');
    if (logSheet.getLastRow() === 0) {
      logSheet.appendRow(['Ημ/νία', 'Τύπος', 'IRN', 'Email', 'Πινακίδα/Τοποθεσία', 'Περιγραφή/Χλμ', '# Αρχεία', 'Φάκελος']);
    }
    logSheet.appendRow([
      new Date(),
      data.type,
      data.irn,
      data.email || '',
      data.plate || data.location || '',
      data.km || data.description || '',
      data.files.length,
      folderUrl
    ]);
  } catch (e) {
    Logger.log('Sheet logging error: ' + e);
  }
}

function sendLocalizedConfirmation(data, folderUrl) {
  if (!data.email) return;
  const lang = data.language === 'en' ? 'en' : 'el';
  const subject = lang === 'el' ? `Επιβεβαίωση Υποβολής - Europcar` : `Submission Confirmation - Europcar`;
  const body = lang === 'el'
    ? `Η υποβολή σας ολοκληρώθηκε επιτυχώς για τον αριθμό <b>${data.irn}</b>.<br>Δείτε τις φωτογραφίες σας εδώ: <a href="${folderUrl}">${folderUrl}</a><br>Ευχαριστούμε για τη συνεργασία.`
    : `Your submission for IRN <b>${data.irn}</b> was successful.<br>You can view your photos here: <a href="${folderUrl}">${folderUrl}</a><br>Thank you for choosing Europcar.`;

  MailApp.sendEmail({
    to: data.email,
    subject,
    htmlBody: body
  });
}

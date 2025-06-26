const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = 3001;
const DB_FILE = path.join(__dirname, 'applications.json');

// Google Sheets configuration
const GOOGLE_SHEETS_CONFIG = {
  SPREADSHEET_ID: process.env.GOOGLE_SHEETS_ID || '', // You'll need to set this
  CREDENTIALS_PATH: path.join(__dirname, 'credentials.json'), // Service account key file
  SHEET_NAME: 'Sheet1' // The actual sheet tab name
};

app.use(cors());
app.use(express.json());

// Google Sheets authentication
async function authenticateGoogleSheets() {
  try {
    const credentials = JSON.parse(fs.readFileSync(GOOGLE_SHEETS_CONFIG.CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    console.log('Google Sheets authentication not configured:', error.message);
    return null;
  }
}

// Upload application to Google Sheets
async function uploadToGoogleSheets(application) {
  try {
    const sheets = await authenticateGoogleSheets();
    if (!sheets || !GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID) {
      console.log('Google Sheets not configured, skipping upload');
      return;
    }

    // Check if headers exist, if not create them
    const headerRange = `${GOOGLE_SHEETS_CONFIG.SHEET_NAME}!A1:M1`;
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID,
      range: headerRange,
    });

    if (!headerResponse.data.values || headerResponse.data.values.length === 0) {
      // Create headers
      const headers = [
        'ID', 'Name', 'Email', 'Age', 'Location', 'Socials', 
        'Building', 'Why', 'Fit', 'Coffee', 'Consent', 'Submitted At'
      ];
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID,
        range: headerRange,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [headers],
        },
      });
    }

    // Add the new application data
    const values = [
      application.id,
      application.name,
      application.email,
      application.age,
      application.location,
      application.socials,
      application.building,
      application.why,
      Array.isArray(application.fit) ? application.fit.join(', ') : application.fit, // Handle array
      application.coffee,
      application.consent,
      application.submittedAt
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID,
      range: `${GOOGLE_SHEETS_CONFIG.SHEET_NAME}!A:M`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [values],
      },
    });

    console.log('Application uploaded to Google Sheets successfully');
  } catch (error) {
    console.error('Error uploading to Google Sheets:', error.message);
  }
}

app.post('/submit-application', (req, res) => {
  const application = req.body;
  
  // Basic validation
  const { name, email, age, location, socials, building, why, fit, coffee, consent } = application;
  if (!name || !email || !location || !socials || !building || !why || !fit || !coffee || !consent) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  let applications = [];
  if (fs.existsSync(DB_FILE)) {
    try {
      applications = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch {
      applications = [];
    }
  }
  
  // Add unique ID and timestamp
  const newApplication = {
    id: Date.now().toString(),
    ...application,
    submittedAt: new Date().toISOString()
  };
  
  applications.push(newApplication);
  
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(applications, null, 2));
    // Upload to Google Sheets (non-blocking)
    uploadToGoogleSheets(newApplication);
    res.status(200).json({ success: true, message: 'Application submitted successfully!' });
  } catch (err) {
    console.error('Error saving application:', err);
    res.status(500).json({ error: 'Failed to save application.' });
  }
});

// GET endpoint to retrieve applications
app.get('/applications', (req, res) => {
  let applications = [];
  if (fs.existsSync(DB_FILE)) {
    try {
      applications = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch {
      applications = [];
    }
  }
  res.json(applications);
});

// Export to Excel
app.get('/export-excel', (req, res) => {
  let applications = [];
  if (fs.existsSync(DB_FILE)) {
    try {
      applications = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch {
      applications = [];
    }
  }

  // Convert JSON to worksheet
  const worksheet = xlsx.utils.json_to_sheet(applications);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Applications');

  // Write to a file
  const filePath = path.join(__dirname, 'applications.xlsx');
  xlsx.writeFile(workbook, filePath);

  // Send the file to the client
  res.download(filePath, (err) => {
    if (err) {
      console.error('Error sending file:', err);
      res.status(500).send('Error exporting data');
    }

    // Optionally, you can delete the file after sending
    fs.unlink(filePath, (err) => {
      if (err) console.error('Error deleting file:', err);
    });
  });
});

// Export applications to CSV
app.get('/export-csv', (req, res) => {
  let applications = [];
  if (fs.existsSync(DB_FILE)) {
    try {
      applications = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch {
      applications = [];
    }
  }

  if (applications.length === 0) {
    return res.status(404).json({ error: 'No applications found to export.' });
  }

  // Create CSV headers
  const headers = ['ID', 'Name', 'Email', 'Age', 'Location', 'Socials', 'Building', 'Why', 'Fit', 'Coffee', 'Consent', 'Submitted At'];
  
  // Convert applications to CSV format
  const csvRows = [headers.join(',')];
  
  applications.forEach(app => {
    const row = [
      app.id,
      `"${app.name}"`,
      app.email,
      app.age,
      `"${app.location}"`,
      `"${app.socials}"`,
      `"${app.building}"`,
      `"${app.why}"`,
      `"${app.fit}"`,
      `"${app.coffee}"`,
      app.consent,
      app.submittedAt
    ];
    csvRows.push(row.join(','));
  });

  const csvContent = csvRows.join('\n');
  
  // Set headers for file download
  res.setHeader('Content-Disposition', 'attachment; filename=inventure-applications.csv');
  res.setHeader('Content-Type', 'text/csv');
  
  res.send(csvContent);
});

// Upload existing applications to Google Sheets
app.post('/migrate-to-sheets', async (req, res) => {
  try {
    let applications = [];
    if (fs.existsSync(DB_FILE)) {
      applications = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }

    if (applications.length === 0) {
      return res.json({ message: 'No applications to migrate' });
    }

    let successCount = 0;
    for (const application of applications) {
      try {
        await uploadToGoogleSheets(application);
        successCount++;
      } catch (error) {
        console.error(`Failed to upload application ${application.id}:`, error.message);
      }
    }

    res.json({ 
      success: true, 
      message: `Migrated ${successCount} out of ${applications.length} applications to Google Sheets` 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to migrate applications' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

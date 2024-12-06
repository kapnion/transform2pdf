const express = require('express');
const fs = require('fs');
const path = require('path');
const SaxonJS = require('saxon-js');
const { JSDOM } = require('jsdom');
const translations = require('./config/translation.json'); // Ensure translation file is required correctly
const htmlPdf = require('html-pdf');
const multer = require('multer'); // Ensure multer is required correctly
const { DOMParser } = require('xmldom'); // Import DOMParser
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const cors = require('cors'); // Import cors
const phantomjs = require('phantomjs-prebuilt');
const phantomPath = phantomjs.path;

const options = {
    phantomPath: phantomPath
};

const app = express();
const port = 8025;

const corsOptions = {
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Allowed methods
  allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
  credentials: true // Allow credentials
};
app.use(cors(corsOptions)); // Enable CORS

// Remove i18next initialization
// i18next.use(Backend).init(i18nextOptions);

app.use(express.json());
const upload = multer({ dest: 'uploads/' });

const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'Transform2PDF API',
      version: '1.0.0',
      description: 'API documentation for Transform2PDF service',
    },
    servers: [
      {
        url: 'http://localhost:8025', // Update to match the correct port
      },
    ],
  },
  apis: [__filename],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

app.post('/upload', upload.single('file'), async (req, res) => {
  /**
   * @swagger
   * /upload:
   *   post:
   *     summary: Upload an XML file and transform it to HTML
   *     consumes:
   *       - multipart/form-data
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *                 description: The XML file to upload
   *     responses:
   *       200:
   *         description: Successfully transformed the XML file to HTML
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 HTML:
   *                   type: string
   *                   description: The transformed HTML content
   *       400:
   *         description: File format not recognized
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                 message:
   *                   type: string
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                 message:
   *                   type: string
   */
  const filePath = req.file.path;
  try {
    const content = fs.readFileSync(filePath).toString();
    const xmlDoc = new DOMParser().parseFromString(content, 'application/xml');
    const rootElement = xmlDoc.documentElement.nodeName;

    let stylesheetUrl = '';
    if (rootElement.includes('CrossIndustryInvoice')) {
      stylesheetUrl = path.join(__dirname, 'xslt', 'cii-xr.sef.json');
    } else if (rootElement.includes('SCRDMCCBDACIOMessageStructure')) {
      stylesheetUrl = path.join(__dirname, 'xslt', 'cio-xr.sef.json');
    } else if (rootElement.includes('Invoice')) {
      stylesheetUrl = path.join(__dirname, 'xslt', 'ubl-xr.sef.json');
    } else if (rootElement.includes('CreditNote')) {
      stylesheetUrl = path.join(__dirname, 'xslt', 'ubl-creditnote-xr.sef.json');
    } else {
      res.status(400).send({
        error: "File format not recognized",
        message: "Is it a UBL 2.1 or UN/CEFACT 2016b XML file or PDF you are trying to open?"
      });
      return;
    }

    await transformAndDisplay(filePath, content, stylesheetUrl, false, res);
  } catch (e) {
    const errMessage = e?.message ? e.message : e;
    res.status(500).send({ error: "Exception", message: errMessage });
  } finally {
    fs.unlinkSync(filePath); // Clean up the uploaded file
  }
});

async function transformAndDisplayCII(sourceFileName, content, shouldDisplay, res) {
  return transformAndDisplay(
    sourceFileName,
    content,
    path.join(__dirname, "xslt", "cii-xr.sef.json"),
    shouldDisplay,
    res
  );
}

async function transformAndDisplayCIO(sourceFileName, content, shouldDisplay, res) {
  return transformAndDisplay(
    sourceFileName,
    content,
    path.join(__dirname, "xslt", "cio-xr.sef.json"),
    shouldDisplay,
    res
  );
}

async function transformAndDisplayUBL(sourceFileName, content, shouldDisplay, res) {
  return transformAndDisplay(
    sourceFileName,
    content,
    path.join(__dirname, "xslt", "ubl-xr.sef.json"),
    shouldDisplay,
    res
  );
}

async function transformAndDisplayUBLCN(sourceFileName, content, shouldDisplay, res) {
  return transformAndDisplay(
    sourceFileName,
    content,
    path.join(__dirname, "xslt", "ubl-creditnote-xr.sef.json"),
    shouldDisplay,
    res
  );
}

async function transformAndDisplay(sourceFileName, content, stylesheetFileName, shouldDisplay, res) {
  const dom = new JSDOM(content, { contentType: "application/xml" });
  const doc = dom.window.document;
  const typecode = doc.evaluate("//rsm:ExchangedDocument/ram:TypeCode", doc, null, 2, null).stringValue;
  const isOrder = (typecode == 220) || (typecode == 231);

  try {
    const output = await SaxonJS.transform({
      stylesheetFileName,
      sourceText: content,
      destination: "serialized"
    }, "async");

    let xrXML = output.principalResult;
    let translationData = { ...translations['de'] }; // Ensure translationData is a map

    if (isOrder) {
      translationData["bt1"] = translationData["bt1_order"];
      translationData["bt2"] = translationData["bt2_order"];
      translationData["bt3"] = translationData["bt3_order"];
      translationData["bg22"] = translationData["bg22_order"];
      translationData["bt25"] = translationData["bt25_order"];
      translationData["bt26"] = translationData["bt26_order"];
      translationData["details"] = translationData["details_order"];
    }

    const response = await SaxonJS.transform({
      stylesheetFileName: path.join(__dirname, "xslt", "xrechnung-html.uni.sef.json"),
      sourceText: xrXML,
      destination: "serialized",
      stylesheetParams: {
        "isOrder": isOrder,
        "showIds": false, // Assuming false for simplicity
        "Q{}i18n": translationData // Pass translation data correctly
      }
    }, "async");

    let HTML = response.principalResult;

    // Convert HTML to PDF
    const pdfFileName = path.basename(sourceFileName, path.extname(sourceFileName)) + '.pdf';
    htmlPdf.create(HTML, options).toFile(pdfFileName, (err, result) => {
      if (err) {
        res.status(500).send({ error: "Exception", message: err.message });
      } else {
        res.download(result.filename, pdfFileName, (err) => {
          if (err) {
            res.status(500).send({ error: "Exception", message: err.message });
          }
          fs.unlinkSync(result.filename); // Clean up the generated PDF file
        });
      }
    });
  } catch (error) {
    const errMessage = error?.message ? error.message : error;
    res.status(500).send({ error: "Exception", message: errMessage });
  }
}

app.listen(port,'0.0.0.0', () => {
  console.log(`Server is running on http://localhost:${port}`);
});
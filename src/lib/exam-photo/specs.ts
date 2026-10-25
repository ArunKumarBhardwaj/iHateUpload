import type { ExamSpec, SlotSpec } from "./types";

/**
 * Upload rules from each body's own notice. Every number here was read from
 * the linked PDF or page on the date in `checked`; see
 * internal/exam-photo/decisions.tsv for conflicts and how they were settled.
 * Rules change between cycles, so re-check the source when a new notice lands.
 */

const CHECKED = "2026-10-25";

const NTA_PHOTO: SlotSpec = {
  kind: "photo",
  label: "Photograph",
  width: 350,
  height: 450,
  minKb: 10,
  maxKb: 200,
  rules: [
    "Colour, face (with ears, no mask) filling about 80% of the photo.",
    "White background.",
  ],
};

function ntaSignature(maxKb: number): SlotSpec {
  return {
    kind: "signature",
    label: "Signature",
    width: 350,
    height: 150,
    minKb: 10,
    maxKb,
    rules: ["Clearly legible."],
  };
}

const NTA_NOTE = "A live photo is also taken during the application. That one is not uploaded from here.";

/** IBPS and SBI publish the same four images, pixel for pixel. */
function bankSlots(declarationRule: string): SlotSpec[] {
  return [
    {
      kind: "photo",
      label: "Photograph",
      width: 200,
      height: 230,
      minKb: 20,
      maxKb: 50,
      pixels: { minWidth: 200, maxWidth: 200, minHeight: 230, maxHeight: 230 },
      rules: [
        "Recent colour passport-style photo, light (preferably white) background.",
        "No cap, hat or dark glasses.",
        "200 × 230 px is the notice's preferred size.",
      ],
    },
    {
      kind: "signature",
      label: "Signature",
      width: 140,
      height: 60,
      minKb: 10,
      maxKb: 20,
      pixels: { minWidth: 140, maxWidth: 140, minHeight: 60, maxHeight: 60 },
      rules: ["Black ink on white paper.", "Not in capital letters.", "140 × 60 px is the notice's preferred size."],
    },
    {
      kind: "thumb",
      label: "Left thumb impression",
      width: 240,
      height: 240,
      minKb: 20,
      maxKb: 50,
      dpi: 200,
      pixels: { minWidth: 240, maxWidth: 240, minHeight: 240, maxHeight: 240 },
      rules: ["Black or blue ink on white paper (3 × 3 cm)."],
    },
    {
      kind: "declaration",
      label: "Handwritten declaration",
      width: 800,
      height: 400,
      minKb: 50,
      maxKb: 100,
      dpi: 200,
      pixels: { minWidth: 800, maxWidth: 800, minHeight: 400, maxHeight: 400 },
      rules: [declarationRule, "Black ink on white paper, in English, not in capital letters (10 × 5 cm)."],
    },
  ];
}

export const EXAMS: ExamSpec[] = [
  {
    slug: "ssc",
    name: "SSC",
    body: "Staff Selection Commission",
    covers: "CGL, CHSL, MTS and other SSC exams",
    slots: [
      {
        kind: "signature",
        label: "Signature",
        width: 360,
        height: 120,
        minKb: 10,
        maxKb: 20,
        rules: [
          "About 6.0 cm wide × 2.0 cm high (the same notice's annexure says 4.0 × 2.0 cm).",
          "Blurred or very small signatures are rejected.",
        ],
      },
    ],
    notes: [
      "SSC now takes your photo live by webcam or phone inside the form, so there is no photo to upload. Use a plain background and no cap, mask or glasses.",
    ],
    source: {
      url: "https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_cgl_2025.pdf",
      title: "SSC CGL Examination 2026 notice, para 9.6",
      date: "21 May 2026",
    },
    checked: CHECKED,
  },
  {
    slug: "upsc",
    name: "UPSC",
    body: "Union Public Service Commission",
    covers: "Civil Services, IES/ISS, ESE and other UPSC exams",
    slots: [
      {
        kind: "photo",
        label: "Photograph",
        width: 400,
        height: 500,
        minKb: 20,
        maxKb: 200,
        pixels: { minWidth: 350, maxWidth: 1000, minHeight: 350, maxHeight: 1000 },
        rules: [
          "Taken within 10 days of the application opening.",
          "Face fills about three quarters of the photo.",
          "Pixel range from UPSC's older online FAQ; current notices give none.",
        ],
      },
      {
        kind: "signature",
        label: "Signature",
        width: 600,
        height: 500,
        minKb: 20,
        maxKb: 100,
        pixels: { minWidth: 350, maxWidth: 1000, minHeight: 350, maxHeight: 1000 },
        rules: [
          "Sign three times, one below the other, on plain white paper in black ink. Upload that one image.",
        ],
      },
    ],
    notes: ["UPSC also takes a live photo during the application."],
    source: {
      url: "https://www.upsc.gov.in/sites/default/files/Exam_Notification_IES_ISS_Eng_11022026.pdf",
      title: "UPSC Examination Notice 07/2026 (IES/ISS)",
      date: "11 Feb 2026",
    },
    checked: CHECKED,
  },
  {
    slug: "neet",
    name: "NEET UG",
    body: "National Testing Agency",
    covers: "NEET (UG) 2026",
    slots: [
      NTA_PHOTO,
      ntaSignature(100),
      {
        kind: "thumb",
        label: "Finger and thumb impressions",
        width: 900,
        height: 600,
        minKb: 50,
        maxKb: 200,
        rules: [
          "Left and right hand fingers and thumb, clearly visible, on white paper.",
          "The bulletin says 10–200 KB in one place and 50–300 KB in another; 50–200 KB meets both.",
        ],
      },
    ],
    notes: [
      NTA_NOTE,
      "The photo must be taken after 1 January 2026. Keep postcard-size (4 × 6 in) and passport-size prints for the exam centre.",
    ],
    source: {
      url: "https://cdnbbsr.s3waas.gov.in/s37bc1ec1d9c3426357e69acd5bf320061/uploads/2026/02/202602231394640855.pdf",
      title: "Information Bulletin NEET (UG) 2026",
      date: "Feb 2026",
    },
    checked: CHECKED,
  },
  {
    slug: "jee-main",
    name: "JEE Main",
    body: "National Testing Agency",
    covers: "JEE (Main) 2027",
    slots: [NTA_PHOTO, ntaSignature(100)],
    notes: [NTA_NOTE],
    source: {
      url: "https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2026/10/202610241890224107.pdf",
      title: "Information Bulletin JEE (Main) 2027",
      date: "Oct 2026",
    },
    checked: CHECKED,
  },
  {
    slug: "cuet-ug",
    name: "CUET UG",
    body: "National Testing Agency",
    covers: "CUET (UG) 2026",
    slots: [NTA_PHOTO, ntaSignature(50)],
    notes: [NTA_NOTE],
    source: {
      url: "https://cdnbbsr.s3waas.gov.in/s3d1a21da7bca4abff8b0b61b87597de73/uploads/2026/01/202601031633478370.pdf",
      title: "CUET (UG) 2026 Information Bulletin",
      date: "Jan 2026",
    },
    checked: CHECKED,
  },
  {
    slug: "ibps",
    name: "IBPS",
    body: "Institute of Banking Personnel Selection",
    covers: "IBPS PO, Clerk and RRB recruitment",
    slots: bankSlots("Write the declaration text given in the IBPS notification in your own handwriting."),
    notes: ["IBPS also takes a live photo during the application. The portal will not move on until each file meets the rules."],
    source: {
      url: "https://www.ibps.in/wp-content/uploads/Detailed-Notification_CRP-PO-XVI_Final_V1_30.06.2026.pdf",
      title: "IBPS CRP PO/MT-XVI Notification",
      date: "30 Jun 2026",
    },
    checked: CHECKED,
  },
  {
    slug: "sbi",
    name: "SBI",
    body: "State Bank of India",
    covers: "SBI PO and Clerk (Junior Associate)",
    slots: bankSlots(
      "Write the declaration from the SBI advertisement in your own handwriting: “I, (name), (date of birth) hereby declare that all the information submitted by me in the application form is correct, true and valid…”",
    ),
    notes: ["SBI also takes a live photo during the application."],
    source: {
      url: "https://sbi.bank.in/csfile/18062026_1_Detailed_Adv.2026.pdf",
      title: "SBI PO Detailed Advertisement CRPD/PO/2026-27/09",
      date: "18 Jun 2026",
    },
    checked: CHECKED,
  },
  {
    slug: "rrb",
    name: "RRB",
    body: "Railway Recruitment Boards",
    covers: "RRB NTPC, JE and other RRB recruitment",
    slots: [
      {
        kind: "signature",
        label: "Signature",
        width: 276,
        height: 157,
        minKb: 30,
        maxKb: 49,
        dpi: 200,
        minDpi: 100,
        pixels: { minWidth: 140, minHeight: 60 },
        rules: [
          "Black ink on white paper, in running handwriting (not block or capital letters).",
          "Centred in a 35 × 20 mm box, scanned at 100 DPI or more.",
        ],
      },
    ],
    notes: [
      "RRB takes your photo live by webcam or phone, so there is no photo to upload. Wear dark, non-white clothes and no cap, mask or glasses.",
    ],
    source: {
      url: "https://rrbsecunderabad.gov.in/wp-content/uploads/2026/08/CEN-04-2026JE_English.pdf",
      title: "RRB CEN 04/2026 (JE), para 14.5.1",
      date: "Aug 2026",
    },
    checked: CHECKED,
  },
  {
    slug: "pan-card",
    name: "PAN card",
    body: "Protean (NSDL) PAN",
    covers: "New PAN application with scanned photo and signature",
    slots: [
      {
        kind: "photo",
        label: "Photograph",
        width: 197,
        height: 276,
        minKb: 0,
        maxKb: 20,
        dpi: 200,
        pixels: { minWidth: 197, maxWidth: 197, minHeight: 276, maxHeight: 276 },
        rules: ["Colour, 3.5 cm high × 2.5 cm wide at 200 DPI, which is 197 × 276 pixels."],
      },
      {
        kind: "signature",
        label: "Signature",
        width: 354,
        height: 157,
        minKb: 0,
        maxKb: 10,
        dpi: 200,
        pixels: { minWidth: 354, maxWidth: 354, minHeight: 157, maxHeight: 157 },
        rules: ["2 cm high × 4.5 cm wide at 200 DPI, which is 354 × 157 pixels."],
      },
    ],
    notes: [
      "Protean's guideline page says 20 KB for the photo and 10 KB for the signature; some Protean articles say 50 KB. These files fit both.",
      "One Protean page words the density as \u201clesser than 200 dpi\u201d while the guideline says 200 DPI; these files are written at exactly 200 DPI.",
    ],
    source: {
      url: "https://tin.tin.proteantech.in/pan/form49Adsc.html",
      title: "Protean: Guidelines for filling PAN New Application",
      date: "page undated",
    },
    checked: CHECKED,
  },
];

export function getExam(slug: string): ExamSpec | undefined {
  return EXAMS.find((e) => e.slug === slug);
}

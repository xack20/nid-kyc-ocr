/** NID card layout and field parsing rules — shared by all Gemini-based modes. */
export const NID_FORMAT = `
════════════════════════════════════════
NID CARD FORMATS
════════════════════════════════════════

LAMINATED NID — FRONT:
  Line 1 : "গণপ্রজাতন্ত্রী বাংলাদেশ সরকার"
  Line 2 : "Government of the People's Republic of Bangladesh"
  Line 3 : "জাতীয় পরিচয় পত্র / National ID Card"
  [gap]
  Line 4 : "নাম: <nameBn>"
  Line 5 : "Name: <nameEn>"
  Line 6 : "পিতা: <fatherNameBn>"
  Line 7 : "মাতা: <motherNameBn>"
  [gap]
  Line 8 : "Date of Birth <DD MMM YYYY>"
  Line 9 : "ID NO: <nidNumber>"   (10, 13, or 17 digits)

LAMINATED NID — BACK:
  ঠিকানা (addressBn) | রক্তের গ্রুপ / Blood Group | প্রদানের তারিখ (issueDate) | Barcode

SMART NID — FRONT: same layout as laminated
SMART NID — BACK: ঠিকানা | Blood Group | PIN | issueDate

════════════════════════════════════════
FIELD PARSING RULES
════════════════════════════════════════
1. Header lines ("গণপ্রজাতন্ত্রী…", "Government of…", "জাতীয় পরিচয়…") are NOT fields — ignore.
2. "নাম:"   → nameBn     "Name:"              → nameEn
3. "পিতা:"  → fatherNameBn  "মাতা:"           → motherNameBn
4. "Date of Birth" → dateOfBirth  (normalise to DD MMM YYYY)
5. "ID NO:" → nidNumber  (digits only, 10 / 13 / 17 characters)
6. "Blood Group:" or "রক্তের গ্রুপ:" → bloodGroup
7. "ঠিকানা:" → addressBn  (may span multiple lines)
8. "প্রদানের তারিখ" → issueDate`;

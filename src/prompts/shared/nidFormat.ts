/**
 * NID card layout reference for all 3 Bangladeshi NID variants.
 * Used by all Gemini-based extraction prompts.
 */
export const NID_FORMAT = `
════════════════════════════════════════
BANGLADESHI NID CARD VARIANTS
════════════════════════════════════════

There are 3 NID card types. You MUST identify the correct type first,
then apply the matching layout rules for field extraction.

──────────────────────────────────────────────────────────
VARIANT 1: LAMINATED NID  (cardType: "laminated")
  Old paper card sealed in plastic laminate. Issued before ~2016.
  NID number: 13 or 17 digits, printed in RED ink.
──────────────────────────────────────────────────────────

  FRONT layout (top → bottom):
    Header 1 : "গণপ্রজাতন্ত্রী বাংলাদেশ সরকার"
    Header 2 : "Government of the People's Republic of Bangladesh"
    Header 3 : "NATIONAL ID CARD  /  জাতীয় পরিচয় পত্র"
    [photo on left, fields on right]
    নাম:   <nameBn>
    Name:  <nameEn>
    পিতা:  <fatherNameBn>
    মাতা:  <motherNameBn>
    Date of Birth:  <DD MMM YYYY>  ← printed in RED
    ID NO:  <nidNumber>            ← printed in RED, 13 or 17 digits

  BACK layout (top → bottom):
    Legal text ("এই কার্ডটি গণপ্রজাতন্ত্রী বাংলাদেশ সরকারের সম্পত্তি...")
    ঠিকানা:  <addressBn>           ← full Bengali address, may span 2-3 lines
    রক্তের গ্রুপ / Blood Group: <value>   ← value in RED
    [signature line]
    প্রদানকারী কর্তৃপক্ষের স্বাক্ষর   [right side] প্রদানের তারিখ: <issueDate>
    [barcode strip at the very bottom]

  LAMINATED-specific notes:
    - placeOfBirth: NOT present on laminated → null, confidence: "unreadable", needsReview: false
    - validUntil: NOT present → null, confidence: "unreadable", needsReview: false
    - fatherNameBn / motherNameBn are on the FRONT side

──────────────────────────────────────────────────────────
VARIANT 2: SMART NID  (cardType: "smart")
  Plastic card with embedded chip. Issued 2016 onwards.
  NID number: exactly 10 digits, shown as "NID No" with spaces (e.g. "123 456 7890").
──────────────────────────────────────────────────────────

  FRONT layout:
    Header 1 : "গণপ্রজাতত্রী বাংলাদেশ সরকার"
    Header 2 : "Government of the People's Republic of Bangladesh"
    Header 3 : "জাতীয় পরিচয়পত্র / National ID Card"  ← NOTE: Bengali FIRST, English second
    [photo on left, chip module on right]
    [field LABELS are tiny captions ABOVE the value, NO colon]
    নাম label → <nameBn>
    Name label → <nameEn>
    পিতা label → <fatherNameBn>
    মাতা label → <motherNameBn>
    Date of Birth: <DD MMM YYYY>
    NID No: <10-digit number>   ← may have spaces between digit groups
    [Signature strip at bottom-left]

  BACK layout (top → bottom):
    [barcode / 2D barcode strip at the TOP]
    ঠিকানা: <addressBn>
    Blood Group: <value>     ← English label only
    Place of Birth: <value>  ← English, present only on smart NID
    Issue Date: <DD MMM YYYY> ← English label
    [Lotus watermark and small photo]
    [MRZ zone — 3 lines of machine-readable text, e.g. "I<BGD1234567890<00<<<<<<<"]

  SMART-specific notes:
    - placeOfBirth: present on BACK (English "Place of Birth")
    - validUntil: NOT present → null, confidence: "unreadable", needsReview: false
    - NID number digits: remove spaces when extracting (e.g. "123 456 7890" → "1234567890")
    - MRZ lines: do NOT extract as any named field; ignore them

──────────────────────────────────────────────────────────
VARIANT 3: TEMPORARY NID  (cardType: "temporary")
  সাময়িক জাতীয় পরিচয়পত্র — paper form, not laminated.
  Usually issued when waiting for permanent card. Often 17 digits.
──────────────────────────────────────────────────────────

  FRONT layout (form/table style):
    Title:  "সাময়িক জাতীয় পরিচয়পত্র"
    নাম: <nameBn>   Name: <nameEn>
    পিতা: <fatherNameBn>   মাতা: <motherNameBn>
    জন্ম তারিখ / Date of Birth: <value>
    NID নম্বর / NID Number: <nidNumber>
    বৈধতার মেয়াদ / Valid Until: <validUntil>   ← UNIQUE to temporary NID

  BACK layout: similar to laminated (ঠিকানা, Blood Group, issueDate)

  TEMPORARY-specific notes:
    - validUntil: present — extract it
    - placeOfBirth: usually NOT present

════════════════════════════════════════
FIELD PARSING RULES (all variants)
════════════════════════════════════════
1.  Header lines are NOT fields — ignore.
2.  নাম: / নাম label → nameBn
3.  Name: / Name label → nameEn
4.  পিতা: / পিতা label → fatherNameBn
5.  মাতা: / মাতা label → motherNameBn
6.  Date of Birth / জন্ম তারিখ → dateOfBirth (normalise to DD MMM YYYY)
7.  ID NO: / NID No / NID নম্বর → nidNumber (digits only, strip spaces, 10/13/17 chars)
8.  Blood Group / রক্তের গ্রুপ → bloodGroup
9.  ঠিকানা → addressBn (may span multiple lines; stop before Blood Group line)
10. প্রদানের তারিখ / Issue Date → issueDate
11. Place of Birth → placeOfBirth (smart NID only)
12. বৈধতার মেয়াদ / Valid Until → validUntil (temporary NID only)
13. MRZ lines (I<BGD...) → IGNORE completely

════════════════════════════════════════
BOTH-SIDE HANDLING
════════════════════════════════════════
When BOTH front and back images are provided:
  - Extract front-side fields from the front image
  - Extract back-side fields from the back image
  - Do NOT mark back-only fields (addressBn, bloodGroup, issueDate, placeOfBirth)
    as "unreadable" when only the front is provided — they are simply absent
    on the front side.

When ONLY the front image is provided:
  - Back-only fields: value: null, confidence: "unreadable", needsReview: false
  - This is expected behaviour, not an error.

When ONLY the back image is provided:
  - Front-only fields: value: null, confidence: "unreadable", needsReview: false`;

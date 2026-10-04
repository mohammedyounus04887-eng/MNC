"""Generate Magic Nutrition Hub feature inventory PDF for client presentation."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, ListFlowable, ListItem
)

OUTPUT = r"C:\Users\pc\OneDrive\Documents\01_Active_Projects\MagicNutritionHub\MagicNutritionHub_Features.pdf"

# ── Color palette ──────────────────────────────────────────────────
BRAND = colors.HexColor("#0F766E")        # teal
ACCENT = colors.HexColor("#0EA5E9")       # sky
DARK = colors.HexColor("#0F172A")
MUTED = colors.HexColor("#475569")
LIGHT_BG = colors.HexColor("#F1F5F9")
RULE = colors.HexColor("#CBD5E1")

# ── Styles ─────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    "TitleX", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=28, leading=34, textColor=BRAND, alignment=TA_LEFT, spaceAfter=4,
)
subtitle_style = ParagraphStyle(
    "SubX", parent=styles["Normal"], fontName="Helvetica",
    fontSize=12, leading=16, textColor=MUTED, spaceAfter=18,
)
h1 = ParagraphStyle(
    "H1X", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=18, leading=22, textColor=colors.white,
    backColor=BRAND, borderPadding=(8, 10, 8, 10),
    spaceBefore=14, spaceAfter=10,
)
h2 = ParagraphStyle(
    "H2X", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=13, leading=17, textColor=BRAND,
    spaceBefore=10, spaceAfter=4,
)
h3 = ParagraphStyle(
    "H3X", parent=styles["Heading3"], fontName="Helvetica-Bold",
    fontSize=11, leading=15, textColor=DARK,
    spaceBefore=6, spaceAfter=2,
)
body = ParagraphStyle(
    "BodyX", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=10, leading=14, textColor=DARK, spaceAfter=2,
)
bullet = ParagraphStyle(
    "BulletX", parent=body, leftIndent=14, bulletIndent=2, spaceAfter=1,
)
small_muted = ParagraphStyle(
    "Small", parent=body, fontSize=9, textColor=MUTED, leading=12,
)
intro = ParagraphStyle(
    "Intro", parent=body, fontSize=11, leading=15, textColor=DARK, spaceAfter=8,
)


def section(title_text):
    return Paragraph(title_text, h1)


def sub(title_text):
    return Paragraph(title_text, h2)


def h3p(title_text):
    return Paragraph(title_text, h3)


def b(items):
    flow = []
    for it in items:
        flow.append(Paragraph("• " + it, bullet))
    return flow


def info_card(label, value):
    t = Table(
        [[Paragraph(f"<b>{label}</b>", small_muted), Paragraph(value, body)]],
        colWidths=[3.6 * cm, 12 * cm],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT_BG),
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


# ── Header / footer ────────────────────────────────────────────────
def header_footer(canvas, doc):
    canvas.saveState()
    w, h = A4
    # Top brand bar
    canvas.setFillColor(BRAND)
    canvas.rect(0, h - 0.6 * cm, w, 0.6 * cm, fill=1, stroke=0)
    # Footer
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(2 * cm, 1.0 * cm, "Magic Nutrition Hub  •  Feature Inventory")
    canvas.drawRightString(w - 2 * cm, 1.0 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.4)
    canvas.line(2 * cm, 1.4 * cm, w - 2 * cm, 1.4 * cm)
    canvas.restoreState()


# ── Document ───────────────────────────────────────────────────────
doc = SimpleDocTemplate(
    OUTPUT, pagesize=A4,
    leftMargin=2 * cm, rightMargin=2 * cm,
    topMargin=2 * cm, bottomMargin=2 * cm,
    title="Magic Nutrition Hub – Feature Inventory",
    author="Magic Nutrition Hub",
)

story = []

# ── Cover ──────────────────────────────────────────────────────────
story.append(Spacer(1, 3 * cm))
story.append(Paragraph("Magic Nutrition Hub", title_style))
story.append(Paragraph("Complete Feature Inventory &amp; Capability Overview", subtitle_style))
story.append(Spacer(1, 0.6 * cm))

cover_box = Table(
    [[Paragraph(
        "<b>An end-to-end multi-tenant platform</b> that runs every operational surface of a "
        "nutrition club &mdash; from member sign-up and face-recognition check-in, to live kitchen "
        "displays, wallet &amp; billing, MLM/referral networks, body-transformation challenges, "
        "and a centralised super-admin command centre.",
        body)]],
    colWidths=[16 * cm],
)
cover_box.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), LIGHT_BG),
    ("BOX", (0, 0), (-1, -1), 0.6, BRAND),
    ("LEFTPADDING", (0, 0), (-1, -1), 14),
    ("RIGHTPADDING", (0, 0), (-1, -1), 14),
    ("TOPPADDING", (0, 0), (-1, -1), 12),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
]))
story.append(cover_box)
story.append(Spacer(1, 0.8 * cm))

story.append(info_card("Portals", "Public Landing • Reception • Kitchen Display • TV Display • Member • Staff • Owner • Super Admin"))
story.append(Spacer(1, 0.2 * cm))
story.append(info_card("Mobile Apps", "4 dedicated Android APKs &mdash; Reception, Kitchen, Admin, Landing (built with Capacitor)"))
story.append(Spacer(1, 0.2 * cm))
story.append(info_card("Stack", "React + TypeScript • Firebase (Auth, Firestore, Functions, FCM, Storage) • face-api.js • RawBT thermal printing"))
story.append(Spacer(1, 0.2 * cm))
story.append(info_card("Highlights", "Real-time sync • Face-recognition check-in • PWA + offline • Push notifications • MLM tree • Receipt printing"))

story.append(PageBreak())

# ── Table of contents (manual) ─────────────────────────────────────
story.append(section("Contents"))
toc_items = [
    "1.  Public Surfaces &mdash; Landing, Join, Reviews",
    "2.  Reception Kiosk",
    "3.  Kitchen Display System",
    "4.  TV Display",
    "5.  Owner Portal (17 modules)",
    "6.  Staff Portal",
    "7.  Member Portal (13 modules)",
    "8.  Super Admin Portal",
    "9.  Cross-cutting Platform Features",
    "10. Technical Capability Summary",
]
for t in toc_items:
    story.append(Paragraph(t, body))
story.append(PageBreak())

# ── 1. Public ──────────────────────────────────────────────────────
story.append(section("1. Public Surfaces"))
story.append(Paragraph("The first touch points for visitors and prospective members.", intro))

story.append(sub("1.1 Landing Page"))
story.append(Paragraph("<i>Route: /  &nbsp;&middot;&nbsp;  Public, unauthenticated</i>", small_muted))
for x in b([
    "Custom branded landing page per club (configurable HTML, club logo &amp; colours).",
    "Quick-link hub to Reception, Member Login, Admin, Kitchen, TV.",
    "Auto-redirects logged-in users to their role-specific dashboard.",
    "Available as a dedicated landing.apk for kiosk deployment.",
]):
    story.append(x)

story.append(sub("1.2 Join Page"))
story.append(Paragraph("<i>Route: /join  &nbsp;&middot;&nbsp;  Public self-service signup</i>", small_muted))
for x in b([
    "Capture: name, phone, WhatsApp, email, password, DOB, current/target weight, health conditions.",
    "Referral lookup &mdash; searchable by member name / ID / phone (auto-attaches to the MLM tree).",
    "Auto-generates a unique Member ID using a name-prefix scheme.",
    "Creates Firebase Auth user + Firestore member record + initial wallet in one step.",
]):
    story.append(x)

story.append(sub("1.3 Leave-a-Review Page"))
story.append(Paragraph("<i>Route: /leave-review  &nbsp;&middot;&nbsp;  Public</i>", small_muted))
for x in b([
    "Star rating + free-text feedback form.",
    "Reviews appear instantly in the Owner&rsquo;s Reviews dashboard for moderation.",
]):
    story.append(x)

story.append(PageBreak())

# ── 2. Reception ───────────────────────────────────────────────────
story.append(section("2. Reception Kiosk"))
story.append(Paragraph("<i>Route: /reception  &nbsp;&middot;&nbsp;  6-digit PIN gate  &nbsp;&middot;&nbsp;  Reception APK</i>", small_muted))
story.append(Paragraph(
    "Tablet-mounted at the front desk. The complete check-in &amp; ordering flow happens here.",
    intro))
for x in b([
    "<b>Member check-in via face scan</b> &mdash; face-api.js (TinyFaceDetector + Landmark68 + Recognition) with liveness check.",
    "<b>123 / ABC keyboard toggle</b> for fast member &amp; volunteer search.",
    "<b>Volunteer check-in</b> by QR code or by tapping a photo card on the volunteer grid.",
    "<b>Real-time volunteer photo grid</b> showing exactly who is on-shift right now.",
    "<b>Visitor log</b> with photo capture at every check-in.",
    "<b>Shake / Afresh order entry</b> on the spot &mdash; flows in real time to the Kitchen tab.",
    "<b>Receipt printing</b> via RawBT thermal printer (branded header, tight label rows).",
    "Performance: parallel writes + navigate-first + club print cache for instant check-in.",
    "PIN fallback if the camera or scanner fails.",
]):
    story.append(x)

story.append(PageBreak())

# ── 3. Kitchen ─────────────────────────────────────────────────────
story.append(section("3. Kitchen Display System (KDS)"))
story.append(Paragraph("<i>Route: /kitchen  &nbsp;&middot;&nbsp;  6-digit PIN gate  &nbsp;&middot;&nbsp;  Kitchen APK</i>", small_muted))
story.append(Paragraph("Wall-mounted screen for the kitchen team. Driven by live Firestore listeners.", intro))
for x in b([
    "<b>Live order queue</b> with member photos updating in real time.",
    "<b>Order workflow:</b> Pending &rarr; Ready &rarr; Served / Rejected.",
    "<b>Today&rsquo;s Specials</b> management &mdash; toggle, set limited / unlimited stock and quantity.",
    "<b>Kitchen stock dashboard</b> with In-Stock / Low / Critical badges per recipe item.",
    "<b>Stock request form with face verification</b> for accountant / manager approval.",
    "<b>Daily shake &amp; Afresh order summary</b> with auto-print.",
    "<b>Recipe / menu editor</b> with full ingredient breakdown.",
    "<b>Auto-print countdown</b> &mdash; 10s timer before automatic receipt dispatch.",
    "Push notification fires to the member when their order is marked Ready.",
]):
    story.append(x)

story.append(PageBreak())

# ── 4. TV Display ──────────────────────────────────────────────────
story.append(section("4. TV Display"))
story.append(Paragraph("<i>Route: /tv  &nbsp;&middot;&nbsp;  Fullscreen carousel for in-club Smart TV</i>", small_muted))
story.append(Paragraph(
    "A rotating presentation that turns the screen on the wall into a live engagement channel.",
    intro))
for x in b([
    "<b>Today&rsquo;s Specials</b> &mdash; image + price slides.",
    "<b>Live order queue</b> &mdash; visual ranking of who&rsquo;s next.",
    "<b>Recently served members</b> celebration slides.",
    "<b>Announcements</b> &mdash; text + images broadcast from the Owner portal.",
    "<b>Birthday &amp; anniversary celebrations</b> with member photos.",
    "<b>Early Bird leaderboard</b> photo posts.",
    "<b>Fun Friday</b> engagement screen.",
    "<b>Club stats snapshot</b> + rotating inspirational quotes.",
    "Slide timing: 10s default, 30s on the queue slide. Welcome spin animation on load.",
]):
    story.append(x)

story.append(PageBreak())

# ── 5. Owner Portal ────────────────────────────────────────────────
story.append(section("5. Owner Portal"))
story.append(Paragraph(
    "<i>Route: /owner/*  &nbsp;&middot;&nbsp;  Firebase Auth (clubOwner role) + 8-digit PIN</i>",
    small_muted))
story.append(Paragraph(
    "The club owner&rsquo;s daily command centre &mdash; 17 dedicated modules covering every operational surface.",
    intro))

owner_modules = [
    ("5.1 Dashboard", [
        "At-a-glance: today&rsquo;s attendance, pending orders, low stock alerts, expiring members.",
        "Pending top-up requests inline (approve / reject without leaving the page).",
        "Drastic weight changes alert (members with &plusmn;5% weekly change).",
        "&ldquo;Today&rsquo;s report&rdquo; one-click print button.",
    ]),
    ("5.2 Members", [
        "Searchable members list with photos, plan, expiry &amp; status.",
        "Member profile: weight progress, attendance history, MLM upline / downline, transactions.",
        "Edit any field, reset password, toggle active status.",
    ]),
    ("5.3 Attendance", [
        "Daily log with photos and timestamps.",
        "Volunteer grid for quick tap-to-check-in.",
        "Streaks &amp; monthly summary analytics.",
    ]),
    ("5.4 Orders Management", [
        "Filter by date / member / status; bulk mark-ready and mark-served.",
        "Receipt printing per order; revenue and top-items stats.",
    ]),
    ("5.5 Inventory", [
        "Master product list, unit-based tracking (not packs).",
        "Reorder thresholds with traffic-light status colours.",
        "Face-verified restock workflow &mdash; basket then batch verify.",
    ]),
    ("5.6 Expiry Management", [
        "List of members expiring this week.",
        "Auto-renewal toggle per plan.",
        "Push reminders 7 days before expiry; printable expiry labels.",
    ]),
    ("5.7 Billing &amp; Reports", [
        "Per-club Firebase usage cost estimate (INR).",
        "Invoice history + payment status badges.",
        "Custom report builder: attendance, revenue, inventory, growth &mdash; exportable to CSV.",
    ]),
    ("5.8 Membership Plans", [
        "Create / edit plans (credits, price, validity, auto-renew).",
        "Activate or deactivate plans without deleting history.",
    ]),
    ("5.9 Wallet Approvals", [
        "Pending top-up queue with full member context.",
        "Approve / reject with admin notes; bulk top-up to many members at once.",
    ]),
    ("5.10 Volunteers", [
        "Add volunteers, assign roles (accountant / inventory / kitchen / reception).",
        "Hour tracking via clock-in/out; weekly summary export.",
    ]),
    ("5.11 Downline Clubs", [
        "Sub-club hierarchy view for franchise / multilevel networks.",
        "Performance roll-up &amp; commission tracking.",
    ]),
    ("5.12 Menu", [
        "Shake recipe editor: photos, ingredients, cost, sell price.",
        "One-tap availability toggle.",
    ]),
    ("5.13 Leaderboard", [
        "Members ranked by visits, weight loss, BTC progress, streak, network size.",
        "Exportable for printing or display.",
    ]),
    ("5.14 BTC (Body Transformation Challenge)", [
        "Multi-session tracking (baseline + weekly).",
        "Captures weight, body-fat %, BMR, muscle mass.",
        "Rankings + CSV bulk import.",
    ]),
    ("5.15 Reviews", [
        "Public review feed with moderation tools.",
    ]),
    ("5.16 Announcements", [
        "Text + image announcements with push-notification broadcast.",
        "Schedule for future publish; view delivery / engagement.",
    ]),
    ("5.17 Club Settings", [
        "Branding (logo, colour, currency name).",
        "Custom landing-page URL.",
        "PIN rotation for kitchen, reception, owner.",
        "Per-club shake / refreshment token toggles.",
        "Backup &amp; restore of club data.",
    ]),
]

for title, items in owner_modules:
    block = [h3p(title)] + b(items) + [Spacer(1, 4)]
    story.append(KeepTogether(block))

story.append(PageBreak())

# ── 6. Staff ───────────────────────────────────────────────────────
story.append(section("6. Staff Portal"))
story.append(Paragraph("<i>Route: /staff/*  &nbsp;&middot;&nbsp;  Firebase Auth (staff role)</i>", small_muted))

story.append(sub("6.1 Staff Dashboard"))
for x in b([
    "Clock in / out with elapsed shift time.",
    "Today&rsquo;s attendance log.",
    "Manual member check-in (scanner backup).",
    "Quick member lookup by name or phone.",
]):
    story.append(x)

story.append(sub("6.2 Order Entry"))
for x in b([
    "Member lookup &rarr; select shake &rarr; submit to kitchen.",
    "Pending orders list visible to staff.",
]):
    story.append(x)

story.append(PageBreak())

# ── 7. Member Portal ───────────────────────────────────────────────
story.append(section("7. Member Portal"))
story.append(Paragraph(
    "<i>Route: /member/*  &nbsp;&middot;&nbsp;  Firebase Auth (member role)</i>",
    small_muted))
story.append(Paragraph(
    "Mobile-first experience &mdash; the member&rsquo;s personal app for the club.",
    intro))

member_modules = [
    ("7.1 Dashboard", [
        "Welcome greeting + membership status badge (Active / Low Credits / No Plan).",
        "Shake balance card with progress bar.",
        "Monthly wallet stats + recent transactions.",
        "Announcement ticker.",
        "Early Bird photo upload (when promotion is live).",
        "One-tap wallet top-up request.",
    ]),
    ("7.2 Profile", [
        "Edit info, upload avatar, change password.",
        "Personal stats (DOB, current / target weight, health conditions).",
        "Per-device push notification toggle.",
    ]),
    ("7.3 Wallet", [
        "Balance in the club&rsquo;s configured currency (e.g. Coins).",
        "Top-up request form with status banner.",
        "Transaction history + monthly spending chart.",
    ]),
    ("7.4 Check-In", [
        "QR scan (club QR or member-card QR).",
        "Manual ID fallback.",
        "Early-bird bonus when checked in before threshold time.",
    ]),
    ("7.5 Attendance", [
        "Monthly calendar with attended days.",
        "Streaks + lifetime visits + visual chart.",
    ]),
    ("7.6 Today&rsquo;s Menu", [
        "Daily shakes + Today&rsquo;s Specials.",
        "Photos, calories, price, in-stock badges.",
    ]),
    ("7.7 Orders", [
        "Place an order, watch its live status (Pending &rarr; Ready &rarr; Served).",
        "Order history with one-tap re-order.",
    ]),
    ("7.8 Digital Member Card", [
        "3D flip animation: photo + ID front, balance + QR back.",
        "Download as PNG, native device share.",
        "QR scannable by reception &amp; staff for check-in.",
    ]),
    ("7.9 MLM Tree / Network", [
        "Hierarchical visualisation of the entire downline.",
        "Direct &amp; total network counts.",
        "Birthday / anniversary popup for network members.",
    ]),
    ("7.10 Progress", [
        "Weight log with chart.",
        "Goal vs current target.",
        "PDF export of the progress report.",
    ]),
    ("7.11 Leaderboard", [
        "Visits / weight loss / BTC / streak rankings, this month or all-time.",
    ]),
    ("7.12 Announcements", [
        "All club messages with read state and unread badge.",
    ]),
    ("7.13 Login &amp; Forgot Password", [
        "Email + password (Firebase) + reset email flow.",
    ]),
]

for title, items in member_modules:
    block = [h3p(title)] + b(items) + [Spacer(1, 4)]
    story.append(KeepTogether(block))

story.append(PageBreak())

# ── 8. Super Admin ─────────────────────────────────────────────────
story.append(section("8. Super Admin Portal"))
story.append(Paragraph(
    "<i>Route: /superadmin/*  &nbsp;&middot;&nbsp;  Hosted on the platform domain</i>",
    small_muted))
story.append(Paragraph(
    "The platform-wide command centre that operates every club from one place.",
    intro))

sa_modules = [
    ("8.1 Dashboard", [
        "Total clubs, total members, platform-wide orders.",
        "Per-club cards with member count, order count and Firebase cost estimate (INR).",
        "Payment status badges (Paid / Due Soon / Overdue).",
        "Unread enquiries count.",
    ]),
    ("8.2 Clubs &mdash; List, Create, Detail", [
        "Search / filter clubs by status and creation date.",
        "Create a new club (owner email, name, country, tier).",
        "Detail view: plans, members, billing, danger zone (archive / reset).",
        "Bulk import clubs from CSV.",
    ]),
    ("8.3 Convert to Club", [
        "One-click promotion of an enquiry into a fully provisioned club.",
        "Pre-populates from enquiry data and assigns subscription tier.",
    ]),
    ("8.4 Platform Tree", [
        "Global MLM structure across all clubs.",
        "Parent &harr; child relationships and roll-up performance.",
    ]),
    ("8.5 Enquiries", [
        "Lead inbox with status pipeline (New / Qualified / In Progress / Won / Lost).",
        "Comment history, email follow-up, convert-to-club action.",
    ]),
    ("8.6 Global Menu", [
        "Master menu templates pushed to all clubs.",
        "Clone-to-clubs bulk action; clubs may override locally.",
    ]),
    ("8.7 Platform Settings", [
        "Branding, email templates, subscription-tier configuration.",
        "FCM VAPID + Firebase config; feature gates per tier.",
    ]),
    ("8.8 Upgrade Requests", [
        "Free &rarr; Trial &rarr; Paid approval workflow with audit trail.",
    ]),
]

for title, items in sa_modules:
    block = [h3p(title)] + b(items) + [Spacer(1, 4)]
    story.append(KeepTogether(block))

story.append(PageBreak())

# ── 9. Cross-cutting ───────────────────────────────────────────────
story.append(section("9. Cross-cutting Platform Features"))
story.append(Paragraph(
    "Capabilities that run across every portal and tie the whole platform together.",
    intro))

cross = [
    ("Authentication &amp; Authorization", [
        "Firebase Auth with custom-claims role gating (member, staff, clubOwner, superAdmin).",
        "6-digit PIN for kitchen / reception, 8-digit for owner.",
        "Domain-based tenancy (club domain vs super-admin domain) prevents cross-tenant leakage.",
    ]),
    ("Push Notifications (FCM)", [
        "Per-device token registration with automatic cleanup.",
        "Triggers: order ready, top-up approved / rejected, announcements, early-bird, fun-friday.",
        "Foreground (toast) and background (native) handling with deep-link payloads.",
    ]),
    ("Face Recognition", [
        "face-api.js (TinyFaceDetector + Landmark68 + Recognition).",
        "Enrollment + liveness check for inventory / stock approvals.",
        "PIN fallback if face capture fails.",
    ]),
    ("Receipt Printing", [
        "RawBT Android intent (rawbt:base64,...) for ESC/POS thermal printers.",
        "Order receipts, daily summary, top-up denial slips, Afresh tokens.",
        "Branded header, auto-print countdown, manual reprint.",
    ]),
    ("Real-time Sync", [
        "Live Firestore listeners on orders, members, inventory, announcements.",
        "Offline cache with automatic reconnect-and-sync.",
    ]),
    ("PWA &amp; Offline", [
        "Service worker, offline banner, install-to-home-screen.",
        "Four dedicated Capacitor APKs: Reception, Kitchen, Admin, Landing.",
    ]),
    ("MLM / Referral Engine", [
        "Tree visualisation in graph and list views.",
        "Upline / downline lookup; birthday + anniversary popups for network members.",
        "Configurable commission structure.",
    ]),
    ("Wallet System", [
        "Per-member balance + transaction ledger.",
        "Top-up workflow: request &rarr; approve &rarr; credit.",
        "Auto-deduct on order served; bulk credit; referral bonus auto-credit.",
    ]),
    ("Daily Schedule Automation", [
        "Auto-applies the weekly schedule on first page load each day.",
        "Time-based push (e.g. 6am early-bird reminder).",
    ]),
    ("Reporting / Analytics", [
        "Daily report, attendance analytics, revenue by date / item / plan.",
        "Drastic weight-change flagging.",
        "CSV exports across all reports.",
    ]),
    ("Billing / Cost Tracking", [
        "Per-club Firebase usage estimation in INR.",
        "Monthly invoicing via Cloud Functions.",
        "Tier management (Free / Trial / Paid) with feature limits.",
    ]),
    ("Mobile-first Responsive UI", [
        "Mobile / tablet / desktop layouts.",
        "Bottom sheets on mobile, side panels on desktop.",
    ]),
]

for title, items in cross:
    block = [h3p(title)] + b(items) + [Spacer(1, 4)]
    story.append(KeepTogether(block))

story.append(PageBreak())

# ── 10. Summary table ──────────────────────────────────────────────
story.append(section("10. Technical Capability Summary"))

data = [
    ["Capability", "Implementation", "Status"],
    ["Multi-tenant SaaS", "Club detection by domain", "Live"],
    ["Firestore real-time DB", "Live listeners + batch writes", "Live"],
    ["Firebase Auth", "Email/password, custom claims, RBAC", "Live"],
    ["Cloud Functions", "Notifications, cost estimation, jobs", "Live"],
    ["FCM Push Notifications", "Tokens, broadcast, deep linking", "Live"],
    ["Face Recognition", "face-api.js, liveness, PIN fallback", "Live"],
    ["Thermal Printer", "RawBT intent, ESC/POS, base64", "Live"],
    ["MLM / Referral Tree", "Parent-child, upline/downline viz", "Live"],
    ["Attendance Tracking", "Check-in/out, hours, calendar", "Live"],
    ["Inventory Management", "Unit-based, restock, recipe cost", "Live"],
    ["Wallet &amp; Payments", "Ledger, top-up, auto-deduct", "Live"],
    ["Digital Member Card", "Flip card, QR, PNG export", "Live"],
    ["PWA &amp; Offline", "Service worker, offline indicator", "Live"],
    ["Dedicated Mobile Apps", "4 APKs via Capacitor", "Live"],
    ["Reporting &amp; Export", "Daily reports, CSV export", "Live"],
    ["Early Bird / Fun Friday", "Time-based bonuses, contests", "Live"],
    ["BTC Challenge", "Multi-session, rankings, import", "Live"],
    ["Billing &amp; Cost Tracking", "Firebase usage, invoices, tiers", "Live"],
]

# Wrap cell text as Paragraphs so it flows
table_data = [[Paragraph(c, body) for c in row] for row in data]

t = Table(table_data, colWidths=[5.5 * cm, 8.5 * cm, 2.5 * cm], repeatRows=1)
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), BRAND),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTSIZE", (0, 0), (-1, 0), 10),
    ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
    ("TOPPADDING", (0, 0), (-1, 0), 8),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
    ("GRID", (0, 0), (-1, -1), 0.4, RULE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 1), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
]))

# Make header row text white
header_row = [Paragraph(f"<font color='white'><b>{c}</b></font>", body) for c in data[0]]
table_data[0] = header_row
t = Table(table_data, colWidths=[5.5 * cm, 8.5 * cm, 2.5 * cm], repeatRows=1)
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), BRAND),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
    ("GRID", (0, 0), (-1, -1), 0.4, RULE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story.append(t)

story.append(Spacer(1, 0.8 * cm))

story.append(Paragraph(
    "<b>Built for scale.</b> Magic Nutrition Hub is a single platform that compresses what would normally take "
    "five separate systems &mdash; reception, kitchen ops, member app, owner CRM, and franchise HQ &mdash; into one "
    "real-time, mobile-first product.",
    intro))

# Build
doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
print(f"Generated: {OUTPUT}")

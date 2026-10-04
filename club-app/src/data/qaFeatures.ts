/**
 * The feature inventory the QA checklist runs on.
 *
 * Built by walking every route, every screen and every writer in the app.
 * Grouped the way a tester moves through the building, not the way the code is
 * organised — someone sitting at the reception desk should be able to work down
 * the Reception list without going anywhere else.
 *
 * `clubSpecific` marks anything hardcoded to Magic Nutrition Club. Those are
 * the items that must become settings before the app is duplicated for another
 * club; the checklist gathers them into their own list.
 *
 * `id` is the Firestore document id for that feature's result. Never rename or
 * renumber one — a changed id orphans the result already recorded against it.
 */

export interface QaFeature {
    id: string;
    name: string;
    /** What the tester should see if it works. Written for a non-developer. */
    expected: string;
    /** Set when the feature is hardcoded to this club. Says what to make configurable. */
    clubSpecific?: string;
}

export interface QaModule {
    key: string;
    title: string;
    /** How to get there. */
    where: string;
    features: QaFeature[];
}

export const QA_MODULES: QaModule[] = [
    {
        key: "reception",
        title: "Reception desk",
        where: "/reception — the tablet at the front desk",
        features: [
            { id: "rec-pin", name: "Reception PIN lock", expected: "Opening /reception asks for the reception PIN. A wrong PIN is refused; the right one opens the home screen.", clubSpecific: "PINs are per-club and set in Settings — confirm a new club can set its own." },
            { id: "rec-home", name: "Home screen — five blocks", expected: "Member Check-in (green), Volunteer (indigo), First Day (amber), Virtual Member (purple), Renewal (rose). All five the same size." },
            { id: "rec-requests", name: "Requests inbox", expected: "An orange banner appears above the blocks when members are waiting to pay, showing a count. Tapping it opens the list." },
            { id: "rec-grid", name: "Member grid", expected: "Every member's face in a grid. People with a phone pre-order appear first, with an orange '#N in queue' badge." },
            { id: "rec-search", name: "Member search", expected: "Finds by name, phone or member ID. The on-screen keyboard must NOT open until you tap the search box." },
            { id: "rec-search-kbd", name: "Search keyboard toggle (123 / ABC)", expected: "The small button beside the search box switches between the number pad and the letter keyboard." },
            { id: "rec-checkin-plain", name: "Check in a walk-in (no pre-order)", expected: "Tap their face: their name is read aloud and their profile opens. Attendance is recorded." },
            { id: "rec-checkin-queue", name: "Check in someone with a pre-order", expected: "Tap their face and confirm. A burst pops over their tile with the shake and token number, the name is read aloud, and they leave the queue." },
            { id: "rec-checkin-voice", name: "Welcome voice", expected: "Tapping a face says 'Welcome <first name>'. Tapping several in a row reads each name in turn without cutting the previous one off." },
            { id: "rec-voice-picker", name: "Welcome voice picker", expected: "Settings → Welcome voice lists the tablet's voices, 'Hear it' plays one, and the choice is remembered on that tablet." },
            { id: "rec-repeat-warn", name: "Already-in-today warning", expected: "Someone already checked in shows a blue '✓ In today' badge, and tapping them asks whether to repeat before anything happens." },
            { id: "rec-checkin-fail", name: "Failed check-in is visible", expected: "If a check-in cannot be saved, a RED burst says 'Not saved — tap again' and stays several seconds. It must never look successful." },
            { id: "rec-couple-two", name: "Couple check-in (two linked accounts)", expected: "Tapping either partner asks who is present. 'Both' checks in both, both names are read out, and the screen ends on the person you actually tapped." },
            { id: "rec-couple-one", name: "Couple check-in (one shared account)", expected: "Asks Both / Only husband / Only wife, and records the answer." },
            { id: "rec-oneday-route", name: "One-Day Shake member routing", expected: "Tapping a one-day member offers 'Deduct credits' or 'One-day shake' before anything is charged.", clubSpecific: "One-day shake price is fixed at ₹240 in code — must become a club setting." },
            { id: "rec-viewonly", name: "View Member (no attendance)", expected: "Settings → View Member, then tap a face: the profile opens and NO attendance is recorded." },
            { id: "rec-face", name: "Face verification (when switched on)", expected: "With face verify on, tapping a face opens the camera and matches. Two failures fall back to OTP." },
            { id: "rec-qr-scan", name: "Member card scan", expected: "Scanning a printed member card with the QR reader opens that member." },
            { id: "rec-order", name: "Order a shake at the desk", expected: "From a member's profile: add shakes, confirm. Credits come off, a kitchen order and token are created, the token prints." },
            { id: "rec-order-dupe", name: "Duplicate shake warning", expected: "Ordering a second shake for someone who already has one today asks whether it is an extra before charging." },
            { id: "rec-products", name: "Sell products from the cart", expected: "Add products, choose cash / UPI / split, Confirm All. The money, the sale record and the stock all move together." },
            { id: "rec-products-stale", name: "Cart-changed guard", expected: "Enter a split, then change the cart. Confirm is blocked and says the cart changed — it must not save a split that no longer matches." },
            { id: "rec-topup", name: "Wallet top-up at the desk", expected: "Adds to the member's balance and records the money." },
            { id: "rec-renew-block", name: "Renewal block", expected: "The rose Renewal tile lists everyone, most overdue first, with credits and days left. Expired shows a red border, under five days orange." },
            { id: "rec-renew-flow", name: "Renewal: member → plan → payment → accountant", expected: "Pick a member, search and pick a plan, choose cash/UPI/split, pick the accountant. The invoice prints and credits and expiry update." },
            { id: "rec-renew-once", name: "Renewal charges once", expected: "Pressing confirm twice quickly must sell ONE plan, not two." },
            { id: "rec-plan-nocredit", name: "Plans that grant no credits", expected: "A plan marked 'no shake credits' sells without adding credits, and says so in the picker before you commit." },
            { id: "rec-plan-label", name: "Credits shown match credits given", expected: "The credits shown against a plan are exactly what the member receives. A number guessed from the duration says '(from duration)'." },
            { id: "rec-firstday", name: "First Day complimentary shake", expected: "Phone number first, then name. Eligibility shows live. Two free trials per phone, then blocked." },
            { id: "rec-firstday-photo", name: "First Day photo", expected: "A photo is captured so the kitchen can identify them." },
            { id: "rec-guest", name: "Guest entry wizard", expected: "Add a guest with shakes and/or products, paid or complimentary, take payment, print.", clubSpecific: "Guest shake price is fixed at ₹240 in code — must become a club setting." },
            { id: "rec-guest-photo", name: "Guest photo capture", expected: "The wizard asks for a photo of each guest whether or not face verification is on. Capture works only once the camera is live." },
            { id: "rec-volunteer", name: "Volunteer sign-in / sign-out", expected: "Only members marked as volunteers appear. Signing in and out records hours." },
            { id: "rec-volunteer-auto", name: "Volunteer auto-mark", expected: "A member who is also a volunteer is marked present on the Volunteers page when they check in — no second scan needed." },
            { id: "rec-volunteer-remove", name: "Remove today's volunteering", expected: "Settings → Remove Today's Volunteering undoes an auto-mark." },
            { id: "rec-enroll", name: "Face enrolment", expected: "Capture three poses. If a plan is chosen at the same time, the payment and credits are recorded too." },
            { id: "rec-virtual", name: "Virtual members — add and list", expected: "Add a virtual member and see the list with expiry status." },
            { id: "rec-virtual-renew", name: "Virtual member renewal", expected: "Pick member, amount, method, plan. Saves with no error and appears in the renewal history." },
            { id: "rec-virtual-backdate", name: "Virtual member back-dated expiry", expected: "'Different Date' extends expiry for money already collected. Saving must NOT show an error." },
            { id: "rec-virtual-bulk", name: "Bulk renewal", expected: "Pick a date, tick members, save. Shows how many renewed, the money recorded, and skips anyone already renewed on that date." },
            { id: "rec-virtual-bulk-retry", name: "Bulk renewal retry", expected: "If some fail they are listed BY NAME, and 'Retry' renews only those — nobody is charged twice." },
            { id: "rec-virtual-report", name: "Virtual renewal report", expected: "Pick a date range and generate. Lists renewals with totals, and prints." },
            { id: "rec-today-drawer", name: "Today's activity drawer", expected: "Shows today's payments and check-ins, with reprint and remove." },
            { id: "rec-session", name: "Session summary print", expected: "Prints a slip of everything done for that member during the visit." },
            { id: "rec-birthday", name: "Birthday recognition", expected: "A member whose birthday is today triggers the birthday tune and shows on the TV." },
        ],
    },
    {
        key: "kitchen",
        title: "Kitchen screen",
        where: "/kitchen — the screen in the kitchen",
        features: [
            { id: "kit-pin", name: "Kitchen PIN lock", expected: "Asks for the kitchen PIN before showing any orders." },
            { id: "kit-orders", name: "Live order cards", expected: "New orders appear without refreshing, oldest first, each with a large member photo, name, flavour and token." },
            { id: "kit-photo-size", name: "Photo big enough to identify", expected: "The face on each card is large and clear enough to recognise the person standing at the counter." },
            { id: "kit-search", name: "Order search", expected: "The search box stays pinned at the top while scrolling, and finds by name, phone, member ID, token or flavour." },
            { id: "kit-search-served", name: "Search covers served orders", expected: "Searching a name finds them whether their shake is still waiting or was served earlier today." },
            { id: "kit-serve", name: "Mark as served", expected: "Removes the card from the waiting list and adds it to today's log." },
            { id: "kit-reject", name: "Reject an order", expected: "Asks for a reason and moves the order to the rejected list." },
            { id: "kit-guest-pin", name: "Guest orders pinned to the top", expected: "Guest and first-day orders appear before member orders." },
            { id: "kit-reprint", name: "Reprint tokens", expected: "Reprints today's token slips." },
            { id: "kit-timer", name: "Waiting timer", expected: "Each card shows how long the order has been waiting." },
            { id: "kit-sound", name: "New-order sound", expected: "A sound plays when a new order arrives." },
        ],
    },
    {
        key: "tv",
        title: "TV display",
        where: "/tv — the screen on the wall",
        features: [
            { id: "tv-welcome", name: "Welcome interruption", expected: "When someone checks in, their photo and name appear on the TV." },
            { id: "tv-birthday", name: "Birthday celebration", expected: "A birthday member gets an extra celebration overlay." },
            { id: "tv-board", name: "Attendance / leaderboard", expected: "Shows today's attendance and any rankings." },
            { id: "tv-specials", name: "Today's specials", expected: "Shows the day's shakes." },
            { id: "tv-visits", name: "Visit count on the welcome", expected: "KNOWN ISSUE — the visit number shown is not maintained anywhere and is wrong. Decide whether to remove or fix it." },
        ],
    },
    {
        key: "member",
        title: "Member phone app",
        where: "/member — what members use on their phones",
        features: [
            { id: "mem-login", name: "Member login", expected: "Email and password. A wrong password is refused with a clear message." },
            { id: "mem-forgot", name: "Forgot password", expected: "Sends a reset link to the member's email." },
            { id: "mem-first-pw", name: "Forced password change", expected: "A member with a temporary password is asked to set a new one on first login." },
            { id: "mem-home", name: "Home screen", expected: "Shows credits, membership status and what to do next." },
            { id: "mem-menu", name: "Today's menu and pre-order", expected: "Shows today's shakes, lets the member order, and the order appears in the reception queue." },
            { id: "mem-credits", name: "Credit balance is correct", expected: "The credits shown match what reception and admin show for the same member." },
            { id: "mem-orders", name: "Order history", expected: "Lists the member's past orders. Must NOT be empty for a member the club created." },
            { id: "mem-wallet", name: "Wallet balance and history", expected: "Shows the balance and past transactions." },
            { id: "mem-topup", name: "Raise a top-up request", expected: "The member requests a top-up and it appears for the owner to approve." },
            { id: "mem-attendance", name: "Attendance history", expected: "Shows the days the member visited." },
            { id: "mem-checkin", name: "Self check-in QR", expected: "Shows a QR code for check-in." },
            { id: "mem-card", name: "Digital member card", expected: "Shows the member's permanent QR card." },
            { id: "mem-profile", name: "Profile view and edit", expected: "The member can see and update their details." },
            { id: "mem-photo", name: "Change profile picture", expected: "A new picture changes EVERYWHERE — reception grid, kitchen cards, TV and reports." },
            { id: "mem-preferred", name: "Preferred shake per weekday", expected: "A shake chosen for a weekday is offered when the member is scanned in on that day." },
            { id: "mem-progress", name: "Weigh-in and progress", expected: "The member can log weight and see the chart." },
            { id: "mem-announce", name: "Announcements", expected: "Club announcements appear." },
            { id: "mem-leaderboard", name: "Leaderboard", expected: "Shows rankings." },
            { id: "mem-network", name: "Referral network", expected: "Shows who the member referred." },
            { id: "mem-review", name: "Leave a review", expected: "The member can rate a served shake." },
        ],
    },
    {
        key: "admin-daily",
        title: "Admin — daily running",
        where: "/admin — the owner's dashboard",
        features: [
            { id: "adm-pin", name: "Admin PIN lock", expected: "Asks for the 8-digit admin PIN. Wrong is refused." },
            { id: "adm-today", name: "Today page", expected: "Five numbers and what needs doing today." },
            { id: "adm-dashboard", name: "Dashboard", expected: "Charts and totals for the club. Figures agree with Reports for the same day." },
            { id: "adm-report-open", name: "Today's Report opens", expected: "Shows today's shakes, money, attendance, guests and expenses, updating live." },
            { id: "adm-report-money", name: "Today's Report money is correct", expected: "CRITICAL — Cash in Hand plus UPI Received must exactly equal Total Collected. Count the drawer and compare against Cash in Hand." },
            { id: "adm-report-topup", name: "Top-ups shown separately", expected: "If any wallet top-ups were taken, the report shows 'collected − top-ups = revenue' so the subtraction is visible." },
            { id: "adm-report-print", name: "Today's Report print", expected: "Prints on the thermal printer, cuts the paper at the end, and the font is normal — not stretched or wrapped oddly." },
            { id: "adm-report-letterhead", name: "Letterhead option", expected: "The print picker has a letterhead tick. Off by default; on adds the club address and GST line.", clubSpecific: "The receipt header prints 'Usha Prasad Enterprises' hardcoded — must come from the club record." },
            { id: "adm-report-excel", name: "Today's Report Excel export", expected: "Downloads a spreadsheet with summary, orders, payments, attendance, volunteers, guests and expenses." },
            { id: "adm-report-save", name: "Save today's report", expected: "Saves the day so it can be read back later." },
            { id: "adm-report-tax", name: "Daily tax invoice", expected: "Prints the GST invoice. Its total must match the report printed above it on the same slip." },
            { id: "adm-report-guest-del", name: "Delete a guest from the report", expected: "Removing a guest also removes their order, returns the stock and takes the money out of the day's revenue." },
            { id: "adm-attendance", name: "Attendance register", expected: "Shows who came on each day, and can be reordered." },
            { id: "adm-orders", name: "Orders page", expected: "Lists orders with status, and allows cancel/reject." },
            { id: "adm-menu", name: "Menu and today's specials", expected: "Set the day's shakes, stock type and limited stock counts." },
        ],
    },
    {
        key: "admin-people",
        title: "Admin — people",
        where: "/admin",
        features: [
            { id: "adm-members", name: "Member list", expected: "Search, filter and open any member." },
            { id: "adm-member-add", name: "Add a member", expected: "Creates a member with a generated member ID and a wallet." },
            { id: "adm-member-edit", name: "Edit a member", expected: "Changes save and show everywhere. NOTE — there are three different member edit forms; check the same fields appear in each." },
            { id: "adm-member-profile", name: "Member profile page", expected: "Shows history, credits, membership, orders and payments for one member." },
            { id: "adm-member-export", name: "Download one member's data", expected: "Exports everything the club holds about that member, by month and by day." },
            { id: "adm-member-couple", name: "Couple linking", expected: "Two members can be linked as a couple, or one account marked as a couple." },
            { id: "adm-cards", name: "Member cards (print)", expected: "Prints QR cards, A4 sheet or PVC, with or without photo. A printed card scans correctly at reception." },
            { id: "adm-scan", name: "Scan Station", expected: "Scanning a card marks the member present." },
            { id: "adm-serve", name: "Serve Station", expected: "Scanning at serving records who served whom and when." },
            { id: "adm-volunteers", name: "Volunteers page", expected: "Shows volunteers, hours and the month grid. NOTE — volunteer records exist in two shapes; check reception sign-ins appear here." },
            { id: "adm-enquiries", name: "Enquiries", expected: "Lists enquiries and converts them to members. Converting one at a time and converting several must produce the SAME kind of member." },
            { id: "adm-virtual-numbers", name: "Virtual numbers", expected: "Manage virtual members from the admin side." },
            { id: "adm-network", name: "Club network / downline", expected: "Shows the referral tree." },
        ],
    },
    {
        key: "admin-money",
        title: "Admin — money and stock",
        where: "/admin",
        features: [
            { id: "adm-reports-day", name: "Reports — Daily", expected: "Pick a day: revenue, cash, UPI, shakes, products, expenses. Cash + UPI must equal Total Revenue." },
            { id: "adm-reports-month", name: "Reports — Monthly", expected: "A month of totals with a per-day breakdown. The per-day rows must add up to the month total." },
            { id: "adm-reports-year", name: "Reports — Yearly", expected: "A year of totals by month." },
            { id: "adm-reports-agree", name: "Reports agrees with Today's Report", expected: "CRITICAL — open Reports for today and Today's Report side by side. Cash, UPI and total must match on both." },
            { id: "adm-reports-topup-tile", name: "Wallet top-ups tile", expected: "Shows top-ups collected separately, marked 'not revenue', so revenue can be reconciled against the drawer." },
            { id: "adm-txn", name: "Transactions manager", expected: "The Transactions button lists every payment, shake, membership and product behind the totals." },
            { id: "adm-txn-sum", name: "Transactions list adds up", expected: "CRITICAL — the payments tab ends with 'These N rows add up to ₹X'. Add the rows by hand and check you get the same figure." },
            { id: "adm-txn-edit", name: "Edit a payment amount", expected: "Changing an amount updates the cash/UPI split too, so the record still adds up." },
            { id: "adm-txn-delete", name: "Delete a payment", expected: "Removing a payment also reverses what it caused — credits, wallet, stock." },
            { id: "adm-txn-add", name: "Add a back-dated entry", expected: "A shake, membership or product can be added for a past date." },
            { id: "adm-reports-pdf", name: "Reports PDF export", expected: "The payments table has Cash, UPI and Total columns AND a TOTAL row. Add the columns by hand — they must match the row." },
            { id: "adm-reports-csv", name: "Reports CSV export", expected: "Opens in Excel. A SUM under the Cash column must match the Cash figure in the summary section of the same file." },
            { id: "adm-expenses", name: "Expenses", expected: "Add, edit and delete expenses; they appear in reports as a separate figure and are not netted off revenue." },
            { id: "adm-wallet", name: "Wallet approvals", expected: "Approve or reject member top-up requests; the balance changes and the money is recorded." },
            { id: "adm-plans", name: "Membership plans", expected: "Create and edit plans: price, duration, credits, lucky-dip, and the 'no shake credits' switch." },
            { id: "adm-inventory", name: "Inventory", expected: "Stock levels, add and edit products, daily usage." },
            { id: "adm-inventory-hist", name: "Inventory history", expected: "Shows every stock movement with a reason." },
            { id: "adm-inventory-exp", name: "Expiry management", expected: "Flags products approaching expiry." },
            { id: "adm-datacheck", name: "Data Check", expected: "Finds duplicate payments, duplicate shake charges, and payments whose cash + UPI does not equal their amount." },
        ],
    },
    {
        key: "admin-engagement",
        title: "Admin — engagement and settings",
        where: "/admin",
        features: [
            { id: "adm-announce", name: "Announcements", expected: "Post an announcement; it appears in the member app." },
            { id: "adm-reviews", name: "Reviews", expected: "Approve or reject member reviews; a badge shows pending ones." },
            { id: "adm-awards", name: "Awards / lucky dip", expected: "Runs the monthly award pool." },
            { id: "adm-btc", name: "BTC challenge", expected: "Enrol participants, record weigh-ins, coaches see assigned members' meals." },
            { id: "adm-btc-winners", name: "BTC winners reveal", expected: "The full-screen award reveal page runs without scrolling." },
            { id: "adm-settings", name: "Club settings", expected: "Club name, logo, address, GST, UPI accounts, PINs, accountants, face-verify toggle." },
            { id: "adm-settings-upi", name: "UPI accounts", expected: "Add UPI accounts; they appear as choices when taking payment and in the per-account report breakdown." },
            { id: "adm-settings-pins", name: "PIN management", expected: "Change reception / kitchen / admin / TV PINs; the new PIN works and the old one does not." },
            { id: "adm-appversion", name: "App version switch", expected: "Old/New per surface, plus a this-device-only override. NOTE — currently forced to 'old' in code; confirm whether that should stay." },
        ],
    },
    {
        key: "rebuilt",
        title: "Rebuilt screens (not yet in daily use)",
        where: "Direct URLs — /queue, /checkin, /renew, /sell, /guest",
        features: [
            { id: "new-queue", name: "Queue page", expected: "Phone orders waiting, with Accept and Reject." },
            { id: "new-checkin", name: "Check-in page", expected: "Scan or search, then mark present." },
            { id: "new-renew", name: "Renew page", expected: "Member → plan → cash/UPI → collect." },
            { id: "new-sell", name: "Sell page", expected: "Item → quantity → payment. Money, sale record and stock move together." },
            { id: "new-guest", name: "Guest page", expected: "Mobile first, live eligibility, complimentary or paid." },
        ],
    },
    {
        key: "public",
        title: "Public and entry points",
        where: "Open to anyone with the link",
        features: [
            { id: "pub-landing", name: "Landing page", expected: "The club's public page loads on the club domain.", clubSpecific: "Some landing copy and branding is hardcoded — check it reads correctly for a different club." },
            { id: "pub-join", name: "Join / self sign-up", expected: "A new member can register themselves and then log in." },
            { id: "pub-join-redirect", name: "Registration goes to login", expected: "After registering, the member lands on the login screen, not a dead end." },
            { id: "pub-review", name: "Leave a review link", expected: "The public review link opens and accepts a rating." },
            { id: "pub-card", name: "Card page", expected: "A scanned card resolves to the right member." },
            { id: "pub-notfound", name: "Unknown address", expected: "A wrong URL shows a sensible page, not a blank screen." },
        ],
    },
    {
        key: "platform",
        title: "Super Admin (platform, not the club)",
        where: "/superadmin — only for whoever runs the platform",
        features: [
            { id: "sa-login", name: "Super admin login", expected: "Only a super-admin account can get in." },
            { id: "sa-clubs", name: "Club list", expected: "Lists every club with status." },
            { id: "sa-club-new", name: "Create a club", expected: "THE DUPLICATION TEST — create a brand-new club and confirm it opens with its own name, logo, PINs and no Magic Nutrition data." },
            { id: "sa-club-detail", name: "Club detail", expected: "Open a club, see and edit its settings." },
            { id: "sa-convert", name: "Convert member to club", expected: "Promotes a member to running their own club." },
            { id: "sa-appversions", name: "App versions across clubs", expected: "Switch Old/New per surface for any club remotely." },
            { id: "sa-pins-private", name: "Make PINs private", expected: "The button moves a club's PINs out of public reach; the club shows green afterwards." },
            { id: "sa-globalmenu", name: "Global menu", expected: "Shared product catalogue available to clubs." },
            { id: "sa-billing", name: "Billing and billing reports", expected: "Platform billing figures load." },
            { id: "sa-enquiries", name: "Platform enquiries", expected: "Enquiries from prospective clubs, with CSV export." },
            { id: "sa-upgrades", name: "Upgrade requests", expected: "Requests from clubs to upgrade." },
            { id: "sa-bulk", name: "Bulk member import", expected: "Import members from a spreadsheet into a club." },
            { id: "sa-tree", name: "Platform tree", expected: "The whole club network." },
            { id: "sa-settings", name: "Platform settings", expected: "Platform-wide options." },
        ],
    },
    {
        key: "cross",
        title: "Things that cut across everything",
        where: "Test these last, on a real day",
        features: [
            { id: "x-money-agree", name: "All money screens agree", expected: "CRITICAL — for the same day, Today's Report, Reports, the Transactions modal, the PDF and the CSV must all show the same cash, UPI and total." },
            { id: "x-drawer", name: "Drawer matches the app", expected: "CRITICAL — count the physical cash at close and compare with Cash in Hand. They must match." },
            { id: "x-day-boundary", name: "Early-morning entries land on the right day", expected: "Anything recorded before 5:30am must appear under TODAY, not yesterday. Worth one deliberate early test." },
            { id: "x-print", name: "Printing works throughout", expected: "Token, receipt, session summary, report and invoice all print, cut the paper, and use a normal font." },
            { id: "x-offline", name: "Behaviour when the internet drops", expected: "Take the tablet off wifi mid-task. Nothing should silently claim success — check what the desk sees." },
            { id: "x-refresh", name: "New version reaches the device", expected: "After a deploy, a hard refresh (Ctrl+Shift+R) loads the new version on every device." },
            { id: "x-roles", name: "Each PIN reaches only its own area", expected: "The reception PIN must not open admin; the kitchen PIN must not open reception." },
            { id: "x-notifications", name: "Notifications", expected: "NOTE — push notifications are written but the server side has never been deployed. Confirm whether they are expected to work at all." },
            { id: "x-voice", name: "Voice assistant (Magician)", expected: "PARKED by decision. If it is on, its money answers must agree with the reports." },
            { id: "x-rules", name: "Database security", expected: "KNOWN GAP — anyone signed in can write to any club. Needs App Check before other clubs share the platform. Not a UI test; flag it as a risk." },
        ],
    },
];

/** Every feature, flat — used for counts and the export. */
export const ALL_FEATURES: Array<QaFeature & { moduleKey: string; moduleTitle: string }> =
    QA_MODULES.flatMap((m) => m.features.map((f) => ({ ...f, moduleKey: m.key, moduleTitle: m.title })));

/** The ones hardcoded to this club — what must become configurable to duplicate. */
export const CLUB_SPECIFIC = ALL_FEATURES.filter((f) => !!f.clubSpecific);

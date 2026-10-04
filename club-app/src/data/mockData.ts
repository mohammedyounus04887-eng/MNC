export const CLUB_INFO = {
  name: "Usha Prasad Enterprise",
  clubName: "Magic Nutrition Club (MNC)",
  gstin: "29ACMPB2969F1ZE",
  address: "#150, 18th Cross, CHBS Layout, Vijayanagar",
  phone: "+91 98456 12345",
};

export interface Member {
  id: string;
  name: string;
  phone: string;
  package: "Bronze" | "Silver" | "Gold";
  startDate: string;
  expiryDate: string;
  daysLeft: number;
  status: "Active" | "Expiring" | "Expired";
  totalPoints: number;
  attendance: { date: string; inTime: string; outTime: string }[];
  billingHistory: { date: string; billNo: string; amount: number; items: string }[];
  pointsHistory: { date: string; activity: string; points: number }[];
}

export const members: Member[] = [
  {
    id: "MNC001", name: "Rajesh Kumar", phone: "9845612345", package: "Gold", startDate: "2025-12-01", expiryDate: "2026-02-28", daysLeft: 8, status: "Active", totalPoints: 185,
    attendance: [
      { date: "2026-02-20", inTime: "06:30", outTime: "07:45" },
      { date: "2026-02-19", inTime: "06:25", outTime: "07:40" },
      { date: "2026-02-18", inTime: "06:35", outTime: "07:50" },
    ],
    billingHistory: [
      { date: "2026-02-20", billNo: "B1045", amount: 180, items: "Protein Shake, Sprouts Bowl" },
      { date: "2026-02-15", billNo: "B1020", amount: 350, items: "Green Smoothie, Supplement Pack" },
    ],
    pointsHistory: [
      { date: "2026-02-20", activity: "Early Bird", points: 3 },
      { date: "2026-02-18", activity: "Saturday Training", points: 5 },
      { date: "2026-01-01", activity: "Membership Renewal", points: 20 },
    ],
  },
  {
    id: "MNC002", name: "Priya Sharma", phone: "9876543210", package: "Silver", startDate: "2026-01-15", expiryDate: "2026-02-22", daysLeft: 2, status: "Expiring", totalPoints: 120,
    attendance: [{ date: "2026-02-20", inTime: "07:00", outTime: "08:00" }],
    billingHistory: [{ date: "2026-02-19", billNo: "B1040", amount: 150, items: "Herbal Tea, Aloe Juice" }],
    pointsHistory: [{ date: "2026-02-19", activity: "Ambassador Evening", points: 8 }],
  },
  {
    id: "MNC003", name: "Suresh Reddy", phone: "9123456789", package: "Bronze", startDate: "2025-11-01", expiryDate: "2026-02-21", daysLeft: 1, status: "Expiring", totalPoints: 65,
    attendance: [{ date: "2026-02-18", inTime: "08:00", outTime: "09:00" }],
    billingHistory: [{ date: "2026-02-10", billNo: "B1010", amount: 80, items: "Sprouts Bowl" }],
    pointsHistory: [{ date: "2026-02-10", activity: "Physical Club New Guest", points: 5 }],
  },
  {
    id: "MNC004", name: "Meena Kumari", phone: "9988776655", package: "Gold", startDate: "2026-01-01", expiryDate: "2026-03-31", daysLeft: 39, status: "Active", totalPoints: 210,
    attendance: [{ date: "2026-02-20", inTime: "06:00", outTime: "07:15" }, { date: "2026-02-19", inTime: "06:05", outTime: "07:20" }],
    billingHistory: [{ date: "2026-02-20", billNo: "B1046", amount: 250, items: "Protein Shake, Vitamin Pack" }],
    pointsHistory: [{ date: "2026-02-20", activity: "Star Person", points: 30 }],
  },
  {
    id: "MNC005", name: "Anil Deshmukh", phone: "9112233445", package: "Silver", startDate: "2025-10-01", expiryDate: "2026-02-18", daysLeft: -2, status: "Expired", totalPoints: 90,
    attendance: [], billingHistory: [], pointsHistory: [],
  },
  {
    id: "MNC006", name: "Lakshmi Devi", phone: "9223344556", package: "Gold", startDate: "2026-01-10", expiryDate: "2026-04-10", daysLeft: 49, status: "Active", totalPoints: 155,
    attendance: [{ date: "2026-02-20", inTime: "07:30", outTime: "08:30" }],
    billingHistory: [{ date: "2026-02-18", billNo: "B1035", amount: 200, items: "Herbal Mix, Shake" }],
    pointsHistory: [{ date: "2026-02-18", activity: "New Membership", points: 25 }],
  },
  {
    id: "MNC007", name: "Vikram Singh", phone: "9334455667", package: "Bronze", startDate: "2026-02-01", expiryDate: "2026-02-23", daysLeft: 3, status: "Expiring", totalPoints: 35,
    attendance: [{ date: "2026-02-19", inTime: "09:00", outTime: "10:00" }],
    billingHistory: [], pointsHistory: [{ date: "2026-02-01", activity: "5 Day Trial Pack", points: 10 }],
  },
  {
    id: "MNC008", name: "Shalini Nair", phone: "9445566778", package: "Silver", startDate: "2026-01-20", expiryDate: "2026-03-20", daysLeft: 28, status: "Active", totalPoints: 95,
    attendance: [{ date: "2026-02-20", inTime: "06:45", outTime: "07:55" }],
    billingHistory: [{ date: "2026-02-15", billNo: "B1022", amount: 120, items: "Green Juice" }],
    pointsHistory: [{ date: "2026-02-15", activity: "Volunteering (1 month)", points: 40 }],
  },
  {
    id: "MNC009", name: "Deepak Joshi", phone: "9556677889", package: "Gold", startDate: "2025-12-15", expiryDate: "2026-03-15", daysLeft: 23, status: "Active", totalPoints: 175,
    attendance: [{ date: "2026-02-20", inTime: "06:15", outTime: "07:30" }],
    billingHistory: [{ date: "2026-02-20", billNo: "B1047", amount: 300, items: "Supplement Pack, Shake, Sprouts" }],
    pointsHistory: [],
  },
  {
    id: "MNC010", name: "Kavitha Rao", phone: "9667788990", package: "Bronze", startDate: "2025-09-01", expiryDate: "2026-02-15", daysLeft: -5, status: "Expired", totalPoints: 45,
    attendance: [], billingHistory: [], pointsHistory: [],
  },
];

export interface Volunteer {
  id: string;
  name: string;
  phone: string;
  role: string;
  totalDaysWorked: number;
  totalHoursThisMonth: number;
  attendance: { date: string; inTime: string; outTime: string; totalHours: number }[];
}

export const volunteers: Volunteer[] = [
  {
    id: "V001", name: "Anita Gupta", phone: "9778899001", role: "Front Desk", totalDaysWorked: 45, totalHoursThisMonth: 64,
    attendance: [
      { date: "2026-02-20", inTime: "06:00", outTime: "10:00", totalHours: 4 },
      { date: "2026-02-19", inTime: "06:00", outTime: "10:00", totalHours: 4 },
      { date: "2026-02-18", inTime: "06:00", outTime: "09:30", totalHours: 3.5 },
    ],
  },
  {
    id: "V002", name: "Rahul Verma", phone: "9889900112", role: "Kitchen Helper", totalDaysWorked: 30, totalHoursThisMonth: 48,
    attendance: [
      { date: "2026-02-20", inTime: "05:30", outTime: "09:30", totalHours: 4 },
      { date: "2026-02-19", inTime: "05:30", outTime: "09:00", totalHours: 3.5 },
    ],
  },
  {
    id: "V003", name: "Sunita Patil", phone: "9990011223", role: "Trainer", totalDaysWorked: 60, totalHoursThisMonth: 72,
    attendance: [
      { date: "2026-02-20", inTime: "06:00", outTime: "10:30", totalHours: 4.5 },
    ],
  },
  {
    id: "V004", name: "Mohan Das", phone: "9001122334", role: "Cleaning Staff", totalDaysWorked: 25, totalHoursThisMonth: 40,
    attendance: [
      { date: "2026-02-20", inTime: "05:00", outTime: "08:00", totalHours: 3 },
    ],
  },
];

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  reorderLevel: number;
  status: "OK" | "Low" | "Critical";
  image: string;
}

export const products: Product[] = [
  {
    id: "P001", name: "Protein Shake", category: "Shakes", price: 120, stock: 45, reorderLevel: 10, status: "OK",
    image: "https://images.pexels.com/photos/1092730/pexels-photo-1092730.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P002", name: "Green Smoothie", category: "Shakes", price: 100, stock: 30, reorderLevel: 10, status: "OK",
    image: "https://images.pexels.com/photos/4443508/pexels-photo-4443508.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P003", name: "Mango Shake", category: "Shakes", price: 90, stock: 8, reorderLevel: 10, status: "Low",
    image: "https://images.pexels.com/photos/1346342/pexels-photo-1346342.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P004", name: "Aloe Vera Juice", category: "Healthy Juices", price: 80, stock: 25, reorderLevel: 10, status: "OK",
    image: "https://images.pexels.com/photos/12049997/pexels-photo-12049997.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P005", name: "Amla Juice", category: "Healthy Juices", price: 70, stock: 3, reorderLevel: 10, status: "Critical",
    image: "https://images.pexels.com/photos/8181548/pexels-photo-8181548.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P006", name: "Wheatgrass Shot", category: "Healthy Juices", price: 50, stock: 20, reorderLevel: 5, status: "OK",
    image: "https://images.pexels.com/photos/4443507/pexels-photo-4443507.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P007", name: "Sprouts Bowl", category: "Sprouts", price: 60, stock: 15, reorderLevel: 5, status: "OK",
    image: "https://images.pexels.com/photos/5946789/pexels-photo-5946789.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P008", name: "Mixed Sprouts Salad", category: "Sprouts", price: 70, stock: 4, reorderLevel: 5, status: "Low",
    image: "https://images.pexels.com/photos/5644870/pexels-photo-5644870.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P009", name: "Vitamin C Pack", category: "Supplements", price: 250, stock: 50, reorderLevel: 10, status: "OK",
    image: "https://images.pexels.com/photos/4113130/pexels-photo-4113130.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P010", name: "Protein Powder (500g)", category: "Supplements", price: 800, stock: 12, reorderLevel: 5, status: "OK",
    image: "https://images.pexels.com/photos/7656390/pexels-photo-7656390.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P011", name: "Herbal Tea", category: "Tea", price: 60, stock: 2, reorderLevel: 5, status: "Critical",
    image: "https://images.pexels.com/photos/842544/pexels-photo-842544.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P012", name: "Bronze Membership", category: "Membership Plans", price: 1500, stock: 999, reorderLevel: 0, status: "OK",
    image: "https://images.pexels.com/photos/864939/pexels-photo-864939.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P013", name: "Silver Membership", category: "Membership Plans", price: 2500, stock: 999, reorderLevel: 0, status: "OK",
    image: "https://images.pexels.com/photos/6339345/pexels-photo-6339345.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
  {
    id: "P014", name: "Gold Membership", category: "Membership Plans", price: 4000, stock: 999, reorderLevel: 0, status: "OK",
    image: "https://images.pexels.com/photos/1552245/pexels-photo-1552245.jpeg?auto=compress&cs=tinysrgb&w=400&v=1"
  },
];

export const loyaltyConfig = [
  { activity: "Physical Club New Guest", points: 5 },
  { activity: "5 Day Trial Pack", points: 10 },
  { activity: "New Membership", points: 25 },
  { activity: "Saturday Training", points: 5 },
  { activity: "Ambassador Evening", points: 8 },
  { activity: "Membership Renewal", points: 20 },
  { activity: "Star Person", points: 30 },
  { activity: "Early Bird", points: 3 },
  { activity: "Volunteering (1 month)", points: 40 },
];

export const salesTrendData = Array.from({ length: 30 }, (_, i) => ({
  date: `Feb ${i + 1}`,
  revenue: Math.floor(Math.random() * 5000) + 2000,
}));

export const membershipGrowthData = [
  { month: "Sep", members: 25 },
  { month: "Oct", members: 32 },
  { month: "Nov", members: 38 },
  { month: "Dec", members: 45 },
  { month: "Jan", members: 52 },
  { month: "Feb", members: 58 },
];

export const productSalesData = [
  { name: "Shakes", value: 35, fill: "hsl(122, 46%, 33%)" },
  { name: "Juices", value: 25, fill: "hsl(138, 50%, 45%)" },
  { name: "Sprouts", value: 15, fill: "hsl(28, 80%, 55%)" },
  { name: "Supplements", value: 20, fill: "hsl(38, 92%, 50%)" },
  { name: "Memberships", value: 5, fill: "hsl(150, 40%, 60%)" },
];

export const packageDistributionData = [
  { name: "Bronze", value: 3, fill: "hsl(30, 60%, 55%)" },
  { name: "Silver", value: 3, fill: "hsl(0, 0%, 65%)" },
  { name: "Gold", value: 4, fill: "hsl(45, 90%, 50%)" },
];

export const dailySalesData = [
  { product: "Protein Shake", qty: 12, revenue: 1440 },
  { product: "Green Smoothie", qty: 8, revenue: 800 },
  { product: "Sprouts Bowl", qty: 15, revenue: 900 },
  { product: "Aloe Vera Juice", qty: 6, revenue: 480 },
  { product: "Herbal Tea", qty: 10, revenue: 600 },
  { product: "Vitamin C Pack", qty: 3, revenue: 750 },
];

export const paymentSplitData = [
  { name: "Cash", value: 40, fill: "hsl(122, 46%, 33%)" },
  { name: "UPI", value: 45, fill: "hsl(200, 80%, 50%)" },
  { name: "Card", value: 15, fill: "hsl(28, 80%, 55%)" },
];

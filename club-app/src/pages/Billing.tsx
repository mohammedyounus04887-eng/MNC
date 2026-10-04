import { useState } from "react";
import { Scan, Printer, Save, MessageCircle, Trash2, ShoppingCart, Search, Filter, Leaf, Coffee, Zap, CreditCard, ChevronRight, X } from "lucide-react";
import { products, members, CLUB_INFO } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface CartItem { id: string; name: string; price: number; qty: number; category: string }

const categories = [
  { id: "All", icon: Filter },
  { id: "Shakes", icon: Coffee },
  { id: "Tea", icon: Leaf },
  { id: "Supplements", icon: Zap },
];

export default function Billing() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showInvoice, setShowInvoice] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [memberSearch, setMemberSearch] = useState("");
  const { toast } = useToast();

  const addToCart = (p: typeof products[0]) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === p.id);
      if (existing) return prev.map((item) => item.id === p.id ? { ...item, qty: item.qty + 1 } : item);
      return [...prev, { id: p.id, name: p.name, price: p.price, qty: 1, category: p.category }];
    });
  };

  const removeFromCart = (id: string) => setCart((prev) => prev.filter((item) => item.id !== id));

  const subtotal = cart.reduce((acc, item) => acc + item.price * item.qty, 0);
  const tax = subtotal * 0.05; // 5% GST for nutrition
  const total = subtotal + tax;

  const filteredProducts = selectedCategory === "All" ? products : products.filter(p => p.category === selectedCategory);
  const foundMember = members.find(m => m.id === memberSearch || m.phone === memberSearch);

  return (
    <div className="animate-fade-in min-h-[50vh] h-[calc(100vh-8rem)] sm:h-[calc(100vh-140px)] flex flex-col md:flex-row gap-4 md:gap-8 overflow-hidden">
      {/* Product Selection Area */}
      <div className="flex-1 flex flex-col min-w-0 space-y-4 md:space-y-6 overflow-hidden">
        <div className="flex flex-col md:flex-row gap-3 md:gap-4 flex-shrink-0">
          <div className="flex bg-white p-1 rounded-2xl shadow-soft border border-border flex-1 min-h-[44px]">
            <div className="relative flex items-center px-4 py-2.5 w-full">
              <Search className="w-4 h-4 text-primary mr-3 flex-shrink-0" />
              <input
                className="bg-transparent border-none focus:outline-none text-sm font-bold w-full min-w-0"
                placeholder="Find products..."
              />
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 md:mx-0 md:overflow-visible scrollbar-hide">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-2xl font-black text-xs transition-all flex-shrink-0 min-h-[44px] touch-manipulation ${selectedCategory === cat.id ? "bg-primary text-white shadow-premium" : "bg-white text-muted-foreground hover:bg-secondary/30"
                  }`}
              >
                <cat.icon className="w-4 h-4" /> {cat.id}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6 pr-1 md:pr-2">
          {filteredProducts.map((p) => (
            <div key={p.id} className="premium-card p-0 overflow-hidden group hover:border-primary/50 transition-all flex flex-col">
              <div className="h-32 sm:h-40 relative">
                <img src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt={p.name} />
                <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full text-xs font-black text-wellness-forest shadow-sm">
                  ₹{p.price}
                </div>
              </div>
              <div className="p-3 sm:p-4 flex-1 flex flex-col justify-between">
                <div className="min-w-0">
                  <h4 className="font-bold text-wellness-forest leading-tight mb-1 text-sm sm:text-base truncate">{p.name}</h4>
                  <p className="text-[10px] font-black text-primary uppercase tracking-widest">{p.category}</p>
                </div>
                <Button
                  onClick={() => addToCart(p)}
                  className="w-full mt-3 sm:mt-4 btn-premium bg-secondary/30 text-primary hover:bg-primary hover:text-white group/btn h-10 min-h-[44px] touch-manipulation"
                >
                  Add to Bill
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cart / Checkout Area */}
      <div className="w-full md:w-[400px] flex flex-col min-h-[320px] md:min-h-0 h-full bg-white rounded-2xl md:rounded-[32px] border border-border shadow-premium overflow-hidden flex-shrink-0 md:flex-shrink">
        <div className="p-4 sm:p-6 border-b border-border bg-wellness-cream/50">
          <h3 className="text-lg sm:text-xl font-black text-wellness-forest flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary" /> Current Bill
          </h3>
          <div className="mt-3 sm:mt-4 relative flex items-center bg-white rounded-xl border border-border p-2 min-h-[44px]">
            {foundMember ? (
              <div className="flex items-center justify-between w-full px-2 py-1 bg-secondary/20 rounded-lg animate-in">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-[10px] font-black">
                    {foundMember.name[0]}
                  </div>
                  <span className="text-xs font-black text-wellness-forest">{foundMember.name}</span>
                </div>
                <button onClick={() => setMemberSearch("")} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <>
                <Search className="w-4 h-4 text-muted-foreground ml-2" />
                <input
                  placeholder="Assign Member (ID/Phone)"
                  className="bg-transparent border-none focus:outline-none text-xs font-bold px-3 w-full"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 sm:space-y-4">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
              <div className="w-20 h-20 rounded-full bg-secondary items-center justify-center flex">
                <ShoppingCart className="w-10 h-10 text-primary" />
              </div>
              <p className="font-bold text-wellness-forest">No items added yet</p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="flex gap-4 p-3 rounded-2xl bg-wellness-cream border border-border group">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-wellness-forest truncate">{item.name}</p>
                  <p className="text-[10px] font-black text-muted-foreground uppercase">{item.qty} x ₹{item.price}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-black text-wellness-forest">₹{item.price * item.qty}</p>
                  <button onClick={() => removeFromCart(item.id)} className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-4 sm:p-6 md:p-8 bg-wellness-forest space-y-3 sm:space-y-4 safe-area-bottom">
          <div className="space-y-2">
            <div className="flex justify-between text-white/60 text-xs font-bold"><span>Subtotal</span><span>₹{subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-white/60 text-xs font-bold"><span>GST (5%)</span><span>₹{tax.toFixed(2)}</span></div>
            <div className="flex justify-between text-white text-xl sm:text-2xl font-black pt-2 border-t border-white/10"><span>Total</span><span>₹{total.toFixed(2)}</span></div>
          </div>
          <Button
            disabled={cart.length === 0}
            onClick={() => setShowInvoice(true)}
            className="w-full btn-premium bg-primary hover:bg-white hover:text-wellness-forest text-white h-14 text-base sm:text-lg shadow-glow min-h-[48px] touch-manipulation"
          >
            Generate Invoice <ChevronRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </div>

      <Dialog open={showInvoice} onOpenChange={setShowInvoice}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md rounded-3xl sm:rounded-[40px] p-0 overflow-hidden border-none shadow-premium">
          <div className="bg-wellness-mint p-6 sm:p-8 text-center space-y-2">
            <div className="w-16 h-16 rounded-full bg-primary mx-auto flex items-center justify-center shadow-premium">
              <Printer className="text-white w-8 h-8" />
            </div>
            <h2 className="text-2xl font-black text-wellness-forest pt-2">Invoice Generated</h2>
            <p className="text-xs font-black text-primary uppercase tracking-widest leading-loose">{CLUB_INFO.clubName} • {CLUB_INFO.name}</p>
          </div>
          <div className="p-6 sm:p-8 space-y-6">
            <div className="space-y-3">
              {cart.map(item => (
                <div key={item.id} className="flex justify-between text-sm font-bold text-wellness-forest">
                  <span>{item.name} x {item.qty}</span>
                  <span>₹{item.price * item.qty}</span>
                </div>
              ))}
              <div className="pt-4 border-t-2 border-dashed border-border flex justify-between text-xl font-black text-wellness-forest">
                <span>Grand Total</span>
                <span>₹{total.toFixed(2)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-4">
              <Button className="btn-premium bg-primary text-white">Print Receipt</Button>
              <Button onClick={() => {
                setShowInvoice(false);
                setCart([]);
                setMemberSearch("");
                toast({ title: "Order Complete", description: "Payment recorded successfully." });
              }} variant="outline" className="btn-premium border-primary/20 text-primary">Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

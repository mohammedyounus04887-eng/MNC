import { useState, useMemo } from "react";
import { collection, getDocs, doc, writeBatch, Timestamp } from "firebase/firestore";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, AlertTriangle, CheckCircle2, RefreshCw, Search, ChevronsUpDown, Check } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

// ─── Searchable member picker ─────────────────────────────────────────────

interface MemberOption { id: string; name: string; memberId?: string; }

function MemberCombobox({
    value,
    onChange,
    members,
    placeholder = "Search member…",
    noneLabel = "— No match —",
}: {
    value: string | null;
    onChange: (v: string | null) => void;
    members: MemberOption[];
    placeholder?: string;
    noneLabel?: string;
}) {
    const [open, setOpen] = useState(false);
    const selected = value ? members.find(m => m.id === value) : null;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    className={cn(
                        "flex h-7 w-full items-center justify-between rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm ring-offset-background",
                        "hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-1 focus:ring-ring",
                        !selected && "text-muted-foreground"
                    )}
                >
                    <span className="truncate">
                        {selected ? `${selected.name}${selected.memberId ? ` (${selected.memberId})` : ""}` : noneLabel}
                    </span>
                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
                <Command>
                    <CommandInput placeholder={placeholder} className="h-8 text-xs" />
                    <CommandList>
                        <CommandEmpty>No match found.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem
                                value="__none__"
                                onSelect={() => { onChange(null); setOpen(false); }}
                                className="text-xs text-muted-foreground"
                            >
                                <Check className={cn("mr-2 h-3 w-3", !value ? "opacity-100" : "opacity-0")} />
                                {noneLabel}
                            </CommandItem>
                            {members.map(m => (
                                <CommandItem
                                    key={m.id}
                                    value={`${m.name} ${m.memberId ?? ""}`}
                                    onSelect={() => { onChange(m.id); setOpen(false); }}
                                    className="text-xs"
                                >
                                    <Check className={cn("mr-2 h-3 w-3", value === m.id ? "opacity-100" : "opacity-0")} />
                                    <span className="truncate">{m.name}</span>
                                    {m.memberId && <span className="ml-1 text-muted-foreground font-mono">({m.memberId})</span>}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

// ─── Types ────────────────────────────────────────────────────────────────

type PlanType = "gold_25" | "silver_15" | "silver_5" | "bronze_1" | "auto" | "closed";

interface RegisterMember {
    slNo: number;
    name: string;
    planType: PlanType;
    creditsRemaining: number;
    creditsTotal: number;
    referralNote: string;  // raw text from register (e.g. "PB", "Ranjini")
    autoCredits: boolean;
    isClosed: boolean;
}

interface FirestoreMember {
    id: string;
    name: string;
    phone?: string;
    shakeCredits?: number;
    shakeCreditsPlanTotal?: number;
    autoCredits?: boolean;
    referredBy?: string;
}

// Row state for the import table
interface ImportRow extends RegisterMember {
    firestoreId: string | null;       // matched Firestore member ID
    referredById: string | null;      // resolved referrer Firestore ID
    edited: boolean;
}

// ─── Register Data (from physical register — April 2026) ─────────────────

const REGISTER_DATA: Omit<RegisterMember, never>[] = [
    // Page 1 (1–28)
    { slNo: 1,  name: "PRASAD M. BHAT",    planType: "auto",     creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: true,  isClosed: false },
    { slNo: 2,  name: "USHA P",            planType: "auto",     creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: true,  isClosed: false },
    { slNo: 3,  name: "ARAVIND",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 4,  name: "SAGAR",             planType: "closed",   creditsRemaining: 0,  creditsTotal: 5,  referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 5,  name: "SHANMUKACHAR",      planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 6,  name: "SUJATA C.H",        planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 7,  name: "JANAKI",            planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 8,  name: "DEEPIKA",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 9,  name: "LAKSHMI C",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 10, name: "SHASIKALA",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 11, name: "SHEKAR",            planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 12, name: "ASHWINI",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 13, name: "PUSHPAKIKA",        planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 14, name: "VEENA BHAT",        planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 15, name: "JYOTHISHREE",       planType: "closed",   creditsRemaining: 0,  creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 16, name: "OMPRAKASH",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 17, name: "PRATAP B.S",        planType: "closed",   creditsRemaining: 0,  creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 18, name: "NETHRAVATHI",       planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 19, name: "CHENDANA",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 20, name: "RAJKUMAR NAIK",     planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 21, name: "ANNAPURNA",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 22, name: "B.R. UMA",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 23, name: "SHABANA",           planType: "closed",   creditsRemaining: 0,  creditsTotal: 5,  referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 24, name: "KRISHNA",           planType: "silver_5", creditsRemaining: 5,  creditsTotal: 5,  referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 25, name: "SAVITHA",           planType: "closed",   creditsRemaining: 0,  creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 26, name: "RAJESHWARI",        planType: "silver_15",creditsRemaining: 15, creditsTotal: 15, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 27, name: "GOWRI",             planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 28, name: "BHUVAN",            planType: "silver_15",creditsRemaining: 15, creditsTotal: 15, referralNote: "",          autoCredits: false, isClosed: false },
    // Page 2 (29–56)
    { slNo: 29, name: "NALINI",            planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "PB",        autoCredits: false, isClosed: false },
    { slNo: 30, name: "KIRAN PALRECHA",    planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "PB",        autoCredits: false, isClosed: false },
    { slNo: 31, name: "BHEEMRAJ",          planType: "silver_5", creditsRemaining: 4,  creditsTotal: 5,  referralNote: "PB",        autoCredits: false, isClosed: false },
    { slNo: 32, name: "RAJESWARI",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Chitra",    autoCredits: false, isClosed: false },
    { slNo: 33, name: "RANJINI",           planType: "closed",   creditsRemaining: 0,  creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 34, name: "SAHANA",            planType: "closed",   creditsRemaining: 0,  creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 35, name: "PAVITHRA",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Ranjini",   autoCredits: false, isClosed: false },
    { slNo: 36, name: "SANJIVINI",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "PB",        autoCredits: false, isClosed: false },
    { slNo: 37, name: "JEANNIAH",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 38, name: "MEENAKSHI",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 39, name: "LAKSHMI B.P",       planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 40, name: "LEELAVATHI",        planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 41, name: "NARSIMHA MURTHY",   planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 42, name: "LATHIFA",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 43, name: "JAYALAKSHOTE",      planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 44, name: "INDRANI",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 45, name: "SRIHARI",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Raghavendra",autoCredits: false,isClosed: false },
    { slNo: 46, name: "RAGHAVENDRA",       planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Bittal",    autoCredits: false, isClosed: false },
    { slNo: 47, name: "ANILKUMAR",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Srihari",   autoCredits: false, isClosed: false },
    { slNo: 48, name: "SUNITA",            planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Srihari",   autoCredits: false, isClosed: false },
    { slNo: 49, name: "NARAYAN SHEREGAR",  planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Anil",      autoCredits: false, isClosed: false },
    { slNo: 50, name: "DIMPLE",            planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 51, name: "SUJATHA JR. R",     planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 52, name: "CHETAN",            planType: "closed",   creditsRemaining: 0,  creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 53, name: "KAPIL",             planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 54, name: "SAVITHA VIJAYAN",   planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 55, name: "SARUANNAN",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 56, name: "MUNIMAHADER",       planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    // Page 3 (57–84)
    { slNo: 57, name: "DIVYA SANTOSH",     planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 58, name: "SANTOSH",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 59, name: "SHAKTIVEL",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Alit",      autoCredits: false, isClosed: false },
    { slNo: 60, name: "SHWETHA",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Raghavendra",autoCredits: false,isClosed: false },
    { slNo: 61, name: "MANJUNATH C",       planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 62, name: "MUNIRAJU",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "J. Lakshmi",autoCredits: false, isClosed: false },
    { slNo: 63, name: "VIJAYA G",          planType: "silver_15",creditsRemaining: 15, creditsTotal: 15, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 64, name: "SURAG G.D",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 65, name: "CHINMAYEE",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 66, name: "RAMESH H.D",        planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 67, name: "CHETANBABU",        planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Aravind",   autoCredits: false, isClosed: false },
    { slNo: 68, name: "MOHAN",             planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 69, name: "SHRAVAN",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Divya/Santosh",autoCredits: false,isClosed: false },
    { slNo: 70, name: "SHILPA",            planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 71, name: "NEETU",             planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 72, name: "KAMAKSHI",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Raghavan",  autoCredits: false, isClosed: false },
    { slNo: 73, name: "BHAGYA",            planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Raghavan",  autoCredits: false, isClosed: false },
    { slNo: 74, name: "SUSI KANNAMMA",     planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 75, name: "SUDARSAN",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 76, name: "KRISHNA RAJU",      planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 77, name: "RAMA PRASANNA",     planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 78, name: "SUSHCMITA",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 79, name: "MADHURA",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 80, name: "SOUMYA & KRISHNA",  planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 81, name: "RAGHAV",            planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 82, name: "PADMA",             planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Jyothi/Shree",autoCredits: false,isClosed: false },
    { slNo: 83, name: "SANDHYA",           planType: "closed",   creditsRemaining: 0,  creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 84, name: "RADHIKA ARAVIND",   planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    // Page 4 (85–112)
    { slNo: 85, name: "DIVYA B.H",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Raghavendra",autoCredits: false,isClosed: false },
    { slNo: 86, name: "CHANDANA",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 87, name: "VINUTHA",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 88, name: "PAVITHRA",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 89, name: "SATYA",             planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 90, name: "NAVEEN N",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 91, name: "PURUSHOTTAM",       planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Vinod",     autoCredits: false, isClosed: false },
    { slNo: 92, name: "SHIVU",             planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "PB",        autoCredits: false, isClosed: false },
    { slNo: 93, name: "PREETHI SHIVU",     planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "PB",        autoCredits: false, isClosed: false },
    { slNo: 94, name: "VEDA",              planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "PB",        autoCredits: false, isClosed: false },
    { slNo: 95, name: "NISHAYA",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Veda",      autoCredits: false, isClosed: false },
    { slNo: 96, name: "PREETHI",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "PB",        autoCredits: false, isClosed: false },
    { slNo: 97, name: "KIRAN & SURAJ",     planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 98, name: "SARSWATHI",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Bhagya",    autoCredits: false, isClosed: false },
    { slNo: 99, name: "PRIYANKA R",        planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Kiran",     autoCredits: false, isClosed: false },
    { slNo: 100,name: "KHUSBOO",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Sunod",     autoCredits: false, isClosed: false },
    { slNo: 101,name: "CHINTAN",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Sunod",     autoCredits: false, isClosed: false },
    { slNo: 102,name: "DATRIYA",           planType: "closed",   creditsRemaining: 0,  creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 103,name: "MANU G",            planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 104,name: "PRASANNA",          planType: "silver_5", creditsRemaining: 5,  creditsTotal: 5,  referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 105,name: "MAHALAKSHMI",       planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 106,name: "VIGNESH S",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "PB",        autoCredits: false, isClosed: false },
    { slNo: 107,name: "(blank)",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 108,name: "SOUJANYA",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 109,name: "FAZEELATH",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 110,name: "AZBA",              planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 111,name: "PINKY",             planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 112,name: "SNEHA",             planType: "closed",   creditsRemaining: 0,  creditsTotal: 5,  referralNote: "",          autoCredits: false, isClosed: true  },
    // Page 5 (113–140)
    { slNo: 113,name: "BHIMAT",            planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 114,name: "BASAVARAJ",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Nethra",    autoCredits: false, isClosed: false },
    { slNo: 115,name: "SHEKAR PATIL",      planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 116,name: "SOUJANYA",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Raghu",     autoCredits: false, isClosed: false },
    { slNo: 117,name: "ARUNKUMAR P",       planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "PB",        autoCredits: false, isClosed: false },
    { slNo: 118,name: "DIVYA",             planType: "closed",   creditsRemaining: 0,  creditsTotal: 5,  referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 119,name: "ARUN M.S",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 120,name: "MEENA D",           planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 121,name: "VARSHITH",          planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 122,name: "RAMESH",            planType: "silver_15",creditsRemaining: 15, creditsTotal: 15, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 123,name: "VISHAL PATIL",      planType: "closed",   creditsRemaining: 0,  creditsTotal: 25, referralNote: "PB",        autoCredits: false, isClosed: true  },
    { slNo: 124,name: "YOGESH",            planType: "closed",   creditsRemaining: 0,  creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 125,name: "BASAWARAIU V.N",    planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "Kanagal",   autoCredits: false, isClosed: false },
    { slNo: 126,name: "NANDAN",            planType: "silver_5", creditsRemaining: 5,  creditsTotal: 5,  referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 127,name: "SAROJA",            planType: "silver_5", creditsRemaining: 5,  creditsTotal: 5,  referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 128,name: "CHANDRASHEKAR",     planType: "silver_5", creditsRemaining: 5,  creditsTotal: 5,  referralNote: "PB",        autoCredits: false, isClosed: false },
    { slNo: 129,name: "SURESHKUMAR",       planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 130,name: "SHEKHAR",           planType: "closed",   creditsRemaining: 0,  creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: true  },
    { slNo: 131,name: "SHIVAPRAKASH",      planType: "silver_15",creditsRemaining: 15, creditsTotal: 15, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 132,name: "MANJULA BAI",       planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 133,name: "JYOTHI",            planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 134,name: "MANJULA M",         planType: "gold_25",  creditsRemaining: 25, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 135,name: "TEJASHREE",         planType: "silver_5", creditsRemaining: 5,  creditsTotal: 5,  referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 136,name: "RANGAN",            planType: "gold_25",  creditsRemaining: 23, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 137,name: "VENKATAMMA",        planType: "gold_25",  creditsRemaining: 23, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 138,name: "VENKATSWAMY",       planType: "gold_25",  creditsRemaining: 23, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    { slNo: 139,name: "SHAILAJA",          planType: "gold_25",  creditsRemaining: 23, creditsTotal: 25, referralNote: "Aravind",   autoCredits: false, isClosed: false },
    { slNo: 140,name: "ESHWAR",            planType: "gold_25",  creditsRemaining: 23, creditsTotal: 25, referralNote: "",          autoCredits: false, isClosed: false },
    // Staff / special accounts (not in register — match by MNC ID in app)
    { slNo: 141,name: "RAJKUMAR (MNC-A-134)",  planType: "auto", creditsRemaining: 25, creditsTotal: 25, referralNote: "",         autoCredits: true,  isClosed: false },
    { slNo: 142,name: "PACHAIYAPPAN (MNC-A-141)", planType: "auto", creditsRemaining: 25, creditsTotal: 25, referralNote: "",      autoCredits: true,  isClosed: false },
];

// ─── Plan helpers ─────────────────────────────────────────────────────────

const PLAN_OPTIONS: { value: PlanType; label: string; tier: string; defaultCredits: number }[] = [
    { value: "gold_25",   label: "Gold 25-Day",  tier: "gold",   defaultCredits: 25 },
    { value: "silver_15", label: "15-Day",       tier: "silver", defaultCredits: 15 },
    { value: "silver_5",  label: "Silver 5-Day", tier: "silver", defaultCredits: 5  },
    { value: "bronze_1",  label: "Bronze 1-Day", tier: "bronze", defaultCredits: 1  },
    { value: "auto",      label: "Auto (∞/mo)",  tier: "gold",   defaultCredits: 25 },
    { value: "closed",    label: "Closed / None",tier: "",       defaultCredits: 0  },
];

function planLabel(p: PlanType) {
    return PLAN_OPTIONS.find(o => o.value === p)?.label ?? p;
}

// Simple fuzzy match: normalize names, check if one contains the other
function nameSimilarity(a: string, b: string): number {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
    const na = norm(a);
    const nb = norm(b);
    if (na === nb) return 1;
    // Check token overlap
    const ta = na.split(" ").filter(Boolean);
    const tb = nb.split(" ").filter(Boolean);
    const overlap = ta.filter(t => tb.some(u => u.startsWith(t) || t.startsWith(u)));
    return overlap.length / Math.max(ta.length, tb.length);
}

// ─── Firestore helpers ────────────────────────────────────────────────────

function useClubMembers(clubId: string) {
    return useQuery<FirestoreMember[]>({
        queryKey: ["bulkImport", "members", clubId],
        queryFn: async () => {
            const snap = await getDocs(collection(db, `clubs/${clubId}/members`));
            return snap.docs.map(d => ({ id: d.id, ...d.data() }) as FirestoreMember);
        },
        enabled: !!clubId,
    });
}

// ─── Main Component ───────────────────────────────────────────────────────

export default function BulkImportTab({ clubId }: { clubId: string }) {
    const { toast } = useToast();
    const qc = useQueryClient();
    const { data: members = [], isLoading } = useClubMembers(clubId);
    const [filter, setFilter] = useState<"all" | "matched" | "unmatched" | "closed">("all");
    const [search, setSearch] = useState("");
    const [rows, setRows] = useState<ImportRow[] | null>(null);

    // Build initial rows with auto-matching
    const initialRows = useMemo((): ImportRow[] => {
        return REGISTER_DATA.map(reg => {
            // Auto-match by highest similarity
            let best: FirestoreMember | null = null;
            let bestScore = 0;
            for (const m of members) {
                const score = nameSimilarity(reg.name, m.name ?? "");
                if (score > bestScore && score >= 0.5) {
                    bestScore = score;
                    best = m;
                }
            }
            return {
                ...reg,
                firestoreId: best?.id ?? null,
                referredById: null,
                edited: false,
            };
        });
    }, [members]);

    // Use edited rows if available, else initial
    const displayRows = rows ?? initialRows;

    // Reset rows when members load
    const resetRows = () => setRows(null);

    // Filter displayed rows
    const filteredRows = useMemo(() => {
        let result = displayRows;
        if (filter === "matched")   result = result.filter(r => r.firestoreId);
        if (filter === "unmatched") result = result.filter(r => !r.firestoreId && !r.isClosed);
        if (filter === "closed")    result = result.filter(r => r.isClosed);
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(r => r.name.toLowerCase().includes(q) ||
                (r.firestoreId && members.find(m => m.id === r.firestoreId)?.name?.toLowerCase().includes(q)));
        }
        return result;
    }, [displayRows, filter, search, members]);

    // Members in Firestore not matched to any register entry
    const unmatchedFirestoreMembers = useMemo(() => {
        const matchedIds = new Set(displayRows.map(r => r.firestoreId).filter(Boolean));
        return members.filter(m => !matchedIds.has(m.id));
    }, [displayRows, members]);

    // Update a single row field
    function updateRow(slNo: number, patch: Partial<ImportRow>) {
        setRows(prev => {
            const base = prev ?? initialRows;
            return base.map(r => r.slNo === slNo ? { ...r, ...patch, edited: true } : r);
        });
    }

    // Batch apply mutation
    const applyMutation = useMutation({
        mutationFn: async () => {
            const toUpdate = displayRows.filter(r => r.firestoreId && !r.isClosed);
            if (toUpdate.length === 0) throw new Error("No matched active members to update.");

            const BATCH_SIZE = 400; // Firestore limit is 500 ops per batch
            for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
                const batch = writeBatch(db);
                const chunk = toUpdate.slice(i, i + BATCH_SIZE);
                for (const row of chunk) {
                    const ref = doc(db, `clubs/${clubId}/members`, row.firestoreId!);
                    const update: Record<string, unknown> = {
                        shakeCredits: row.creditsRemaining,
                        shakeCreditsPlanTotal: row.creditsTotal,
                        autoCredits: row.autoCredits,
                        updatedAt: Timestamp.now(),
                    };
                    if (row.referredById) update.referredBy = row.referredById;
                    batch.update(ref, update);
                }
                await batch.commit();
            }
        },
        onSuccess: () => {
            toast({ title: `Updated ${displayRows.filter(r => r.firestoreId && !r.isClosed).length} members` });
            qc.invalidateQueries({ queryKey: ["bulkImport"] });
        },
        onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    });

    const matchedCount  = displayRows.filter(r => r.firestoreId).length;
    const closedCount   = displayRows.filter(r => r.isClosed).length;
    const unmatchedCount = displayRows.filter(r => !r.firestoreId).length;

    if (isLoading) {
        return <div className="py-16 text-center text-muted-foreground animate-pulse text-sm">Loading members…</div>;
    }

    return (
        <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-2xl border bg-blue-50 border-blue-100 p-4 text-center">
                    <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">Register</p>
                    <p className="text-2xl font-black text-blue-900">{REGISTER_DATA.length}</p>
                </div>
                <div className="rounded-2xl border bg-emerald-50 border-emerald-100 p-4 text-center">
                    <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Matched</p>
                    <p className="text-2xl font-black text-emerald-900">{matchedCount}</p>
                </div>
                <div className="rounded-2xl border bg-amber-50 border-amber-100 p-4 text-center">
                    <p className="text-xs font-bold text-amber-600 uppercase tracking-widest">Unmatched</p>
                    <p className="text-2xl font-black text-amber-900">{unmatchedCount}</p>
                </div>
                <div className="rounded-2xl border bg-slate-50 border-slate-200 p-4 text-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">App Only</p>
                    <p className="text-2xl font-black text-slate-900">{unmatchedFirestoreMembers.length}</p>
                </div>
            </div>

            {/* App-only members (in Firestore but not in register) */}
            {unmatchedFirestoreMembers.length > 0 && (
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-500" />
                        <p className="text-sm font-bold text-orange-800">
                            {unmatchedFirestoreMembers.length} member{unmatchedFirestoreMembers.length !== 1 ? "s" : ""} in app but NOT in register
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {unmatchedFirestoreMembers.map(m => (
                            <Badge key={m.id} variant="outline" className="text-xs border-orange-300 text-orange-700 bg-white">
                                {m.name || m.id}
                            </Badge>
                        ))}
                    </div>
                </div>
            )}

            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <div className="relative flex-1 w-full sm:max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-9 h-9"
                    />
                </div>
                <div className="flex gap-1 flex-wrap">
                    {(["all", "matched", "unmatched", "closed"] as const).map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors ${
                                filter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
                <button
                    onClick={resetRows}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border hover:bg-slate-50 text-slate-600 ml-auto"
                >
                    <RefreshCw className="w-3.5 h-3.5" /> Reset
                </button>
            </div>

            {/* Table */}
            <div className="rounded-2xl border overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                        <thead className="bg-slate-50 border-b">
                            <tr>
                                <th className="text-left px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-10">#</th>
                                <th className="text-left px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Register Name</th>
                                <th className="text-left px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider min-w-[160px]">App Member</th>
                                <th className="text-left px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider min-w-[140px]">Plan</th>
                                <th className="text-left px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-20">Remaining</th>
                                <th className="text-left px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-20">Plan Total</th>
                                <th className="text-left px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-16">Auto</th>
                                <th className="text-left px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Referral</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {filteredRows.map(row => {
                                const matched = members.find(m => m.id === row.firestoreId);
                                return (
                                    <tr key={row.slNo} className={`${row.isClosed ? "bg-slate-50 opacity-60" : row.firestoreId ? "" : "bg-amber-50"}`}>
                                        {/* Sl No */}
                                        <td className="px-3 py-2 text-xs text-slate-400 font-mono">{row.slNo}</td>

                                        {/* Register name */}
                                        <td className="px-3 py-2">
                                            <span className="font-semibold text-slate-800 text-xs">{row.name}</span>
                                        </td>

                                        {/* App member match */}
                                        <td className="px-3 py-2 min-w-[180px]">
                                            <MemberCombobox
                                                value={row.firestoreId}
                                                onChange={v => updateRow(row.slNo, { firestoreId: v })}
                                                members={members.map(m => ({ id: m.id, name: m.name ?? m.id, memberId: (m as any).memberId }))}
                                                placeholder="Search by name or ID…"
                                                noneLabel="— No match —"
                                            />
                                        </td>

                                        {/* Plan */}
                                        <td className="px-3 py-2">
                                            <Select
                                                value={row.planType}
                                                onValueChange={v => {
                                                    const pt = v as PlanType;
                                                    const plan = PLAN_OPTIONS.find(p => p.value === pt)!;
                                                    updateRow(row.slNo, {
                                                        planType: pt,
                                                        isClosed: pt === "closed",
                                                        creditsTotal: plan.defaultCredits,
                                                        creditsRemaining: pt === "closed" ? 0 : plan.defaultCredits,
                                                    });
                                                }}
                                            >
                                                <SelectTrigger className="h-7 text-xs w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {PLAN_OPTIONS.map(o => (
                                                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </td>

                                        {/* Credits remaining */}
                                        <td className="px-3 py-2">
                                            <Input
                                                type="number"
                                                min={0}
                                                max={99}
                                                value={row.creditsRemaining}
                                                onChange={e => updateRow(row.slNo, { creditsRemaining: Number(e.target.value), edited: true })}
                                                className="h-7 text-xs w-16 px-2"
                                                disabled={row.isClosed}
                                            />
                                        </td>

                                        {/* Credits total */}
                                        <td className="px-3 py-2">
                                            <Input
                                                type="number"
                                                min={0}
                                                max={99}
                                                value={row.creditsTotal}
                                                onChange={e => updateRow(row.slNo, { creditsTotal: Number(e.target.value), edited: true })}
                                                className="h-7 text-xs w-16 px-2"
                                                disabled={row.isClosed}
                                            />
                                        </td>

                                        {/* Auto-credits flag */}
                                        <td className="px-3 py-2 text-center">
                                            <input
                                                type="checkbox"
                                                checked={row.autoCredits}
                                                onChange={e => updateRow(row.slNo, { autoCredits: e.target.checked })}
                                                className="w-4 h-4 accent-emerald-600"
                                            />
                                        </td>

                                        {/* Referral note */}
                                        <td className="px-3 py-2 min-w-[180px]">
                                            <MemberCombobox
                                                value={row.referredById}
                                                onChange={v => updateRow(row.slNo, { referredById: v })}
                                                members={members.map(m => ({ id: m.id, name: m.name ?? m.id, memberId: (m as any).memberId }))}
                                                placeholder={row.referralNote ? `Search (hint: ${row.referralNote})…` : "Search referrer…"}
                                                noneLabel={row.referralNote ? `(${row.referralNote} — unresolved)` : "— None —"}
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Apply button */}
            <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">
                    {matchedCount - closedCount} matched active members will be updated
                </p>
                <Button
                    onClick={() => applyMutation.mutate()}
                    disabled={applyMutation.isPending || matchedCount === 0}
                    className="bg-emerald-600 hover:bg-emerald-700 gap-2"
                >
                    {applyMutation.isPending ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" /> Applying…</>
                    ) : (
                        <><CheckCircle2 className="w-4 h-4" /> Apply {matchedCount - closedCount} Updates</>
                    )}
                </Button>
            </div>
        </div>
    );
}

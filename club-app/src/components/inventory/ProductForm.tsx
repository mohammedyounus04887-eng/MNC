import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Timestamp } from "firebase/firestore";
import { Coffee, Upload, X, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useClubContext } from "@/lib/clubDetection";
import type { Product } from "@/types/firestore";
import { uploadBytes, ref, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";

const productSchema = z.object({
    name: z.string().min(2, "Name is required"),
    category: z.enum(["shake", "supplement", "snack", "other"]),
    stock: z.coerce.number().min(0, "Stock cannot be negative"),
    lowStockThreshold: z.coerce.number().min(0),
    expiryDate: z.string().optional(),
    isAvailableToday: z.boolean().default(false),
});

interface Props {
    defaultValues?: Partial<Product>;
    mode: "add" | "edit";
    isLoading?: boolean;
    onSubmit: (data: Omit<Product, "id" | "clubId" | "createdAt" | "updatedAt">) => Promise<void>;
    onClose: () => void;
}

export default function ProductForm({ defaultValues, mode, isLoading, onSubmit, onClose }: Props) {
    const { club } = useClubContext();
    const [photoFile, setPhotoFile] = useState<File | null>(null);
    const [photoUrl, setPhotoUrl] = useState<string>(defaultValues?.photo || "");
    const [uploading, setUploading] = useState(false);
    const [urlInput, setUrlInput] = useState<string>("");

    const form = useForm<z.infer<typeof productSchema>>({
        resolver: zodResolver(productSchema),
        defaultValues: {
            name: defaultValues?.name || "",
            category: (defaultValues?.category as "shake" | "supplement" | "snack" | "other") || "shake",
            stock: defaultValues?.stock || 0,
            lowStockThreshold: defaultValues?.lowStockThreshold || 10,
            expiryDate: defaultValues?.expiryDate ? defaultValues.expiryDate.toDate().toISOString().split("T")[0] : "",
            isAvailableToday: defaultValues?.isAvailableToday || false,
        },
    });

    const handlePhotoUpload = async (file: File) => {
        if (!club) return;
        setUploading(true);
        const id = defaultValues?.id || "temp_" + Date.now();
        const storageRef = ref(storage, `clubs/${club.id}/products/${id}/photo`);
        try {
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            setPhotoUrl(url);
        } catch (err) {
            console.error("Upload failed", err);
        }
        setUploading(false);
    };

    const submitWrapper = async (values: z.infer<typeof productSchema>) => {
        let exp: Timestamp | null = null;
        if (values.expiryDate) {
            const d = new Date(values.expiryDate);
            exp = Timestamp.fromDate(d);
        }

        await onSubmit({
            name: values.name,
            category: values.category,
            price: 0,
            stock: values.stock,
            lowStockThreshold: values.lowStockThreshold,
            expiryDate: exp,
            isAvailableToday: values.isAvailableToday,
            photo: photoUrl,
        });
    };

    return (
        <div className="bg-white rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">{mode === "add" ? "Add New Product" : "Edit Product"}</h2>
                <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
            </div>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(submitWrapper)} className="space-y-4">
                    {/* Photo */}
                    <div className="flex flex-col items-center gap-3 mb-6">
                        <div className="relative">
                            <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden border">
                                {photoUrl ? <img src={photoUrl} className="w-full h-full object-cover" alt="" /> : <Coffee className="w-8 h-8 text-gray-400" />}
                            </div>
                            <label className="absolute bottom-0 right-0 bg-violet-600 text-white p-1.5 rounded-full cursor-pointer hover:bg-violet-700 shadow-md">
                                <Upload className="w-4 h-4" />
                                <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) { setPhotoFile(f); handlePhotoUpload(f); }
                                }} />
                            </label>
                        </div>
                        <div className="w-full flex gap-2 items-center">
                            <div className="relative flex-1">
                                <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="url"
                                    placeholder="Or paste image URL"
                                    className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                                    value={urlInput}
                                    onChange={(e) => setUrlInput(e.target.value)}
                                />
                            </div>
                            <button
                                type="button"
                                className="px-3 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap"
                                disabled={!urlInput.trim()}
                                onClick={() => {
                                    if (urlInput.trim()) {
                                        setPhotoUrl(urlInput.trim());
                                        setUrlInput("");
                                    }
                                }}
                            >
                                Use URL
                            </button>
                        </div>
                        {photoUrl && (
                            <button
                                type="button"
                                className="text-xs text-red-500 hover:text-red-700"
                                onClick={() => { setPhotoUrl(""); setUrlInput(""); }}
                            >
                                Remove image
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="name" render={({ field }) => (
                            <FormItem className="col-span-2 md:col-span-1">
                                <FormLabel>Product Name</FormLabel>
                                <FormControl><Input {...field} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />

                        <FormField control={form.control} name="category" render={({ field }) => (
                            <FormItem className="col-span-2 md:col-span-1">
                                <FormLabel>Category</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                    <SelectContent>
                                        <SelectItem value="shake">Shake</SelectItem>
                                        <SelectItem value="supplement">Supplement</SelectItem>
                                        <SelectItem value="snack">Snack</SelectItem>
                                        <SelectItem value="other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )} />

                        <FormField control={form.control} name="stock" render={({ field }) => (
                            <FormItem className="col-span-2 md:col-span-1">
                                <FormLabel>{mode === "add" ? "Initial Stock" : "Current Stock"}</FormLabel>
                                <FormControl><Input type="number" {...field} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />

                        <FormField control={form.control} name="lowStockThreshold" render={({ field }) => (
                            <FormItem className="col-span-2 md:col-span-1">
                                <FormLabel>Low Stock Threshold</FormLabel>
                                <FormControl><Input type="number" {...field} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />

                        <FormField control={form.control} name="expiryDate" render={({ field }) => (
                            <FormItem className="col-span-2 md:col-span-1">
                                <FormLabel>Expiry Date (Optional)</FormLabel>
                                <FormControl><Input type="date" {...field} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />

                        <FormField control={form.control} name="isAvailableToday" render={({ field }) => (
                            <FormItem className="col-span-2 flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
                                <div className="space-y-0.5">
                                    <FormLabel className="text-base">Available Today</FormLabel>
                                    <div className="text-xs text-muted-foreground">Show this product in the member app today's menu.</div>
                                </div>
                                <FormControl>
                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                </FormControl>
                            </FormItem>
                        )} />
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={isLoading || uploading}>
                            {uploading ? "Uploading Image…" : isLoading ? "Saving…" : "Save Product"}
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    );
}

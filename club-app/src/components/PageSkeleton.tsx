import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function PageSkeleton() {
    return (
        <div className="w-full min-h-screen p-6 space-y-6">
            <div className="flex items-center space-x-4 mb-8">
                <Skeleton className="h-12 w-12 rounded-xl" />
                <div className="space-y-2">
                    <Skeleton className="h-4 w-[250px]" />
                    <Skeleton className="h-4 w-[200px]" />
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Skeleton className="h-32 w-full rounded-2xl" />
                <Skeleton className="h-32 w-full rounded-2xl" />
                <Skeleton className="h-32 w-full rounded-2xl" />
                <Skeleton className="h-32 w-full rounded-2xl" />
            </div>

            <div className="space-y-4 mt-8">
                <Skeleton className="h-8 w-[300px]" />
                <Skeleton className="h-64 w-full rounded-3xl" />
            </div>
        </div>
    );
}

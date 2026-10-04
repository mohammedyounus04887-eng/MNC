import { Timestamp } from "firebase/firestore";
import { Badge } from "@/components/ui/badge";

interface Props {
    maintenancePaid: boolean;
    maintenanceDueDate: Timestamp | null;
}

export default function MaintenanceBadge({ maintenancePaid, maintenanceDueDate }: Props) {
    if (maintenancePaid) {
        return (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-xs">
                Paid
            </Badge>
        );
    }

    const isOverdue =
        maintenanceDueDate &&
        maintenanceDueDate.toDate &&
        maintenanceDueDate.toDate() < new Date();

    if (isOverdue) {
        return (
            <Badge variant="destructive" className="text-xs">
                Overdue
            </Badge>
        );
    }

    return (
        <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700 text-xs">
            Due
        </Badge>
    );
}

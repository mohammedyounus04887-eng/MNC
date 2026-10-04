import type { Club } from "@/types/firestore";

interface Props {
    club: Club;
}

export default function ComingSoonPage({ club }: Props) {
    return (
        <div className="min-h-screen bg-white flex items-center justify-center px-6">
            <div className="text-center max-w-md mx-auto">
                <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">
                    {club.name}
                </h1>
                <p className="text-lg text-gray-500 mb-8">Coming Soon</p>

                <div className="h-px w-24 bg-gray-200 mx-auto mb-8" />

                <p className="text-gray-500 mb-10">
                    We're setting things up. Check back soon!
                </p>

                {club.ownerPhone && (
                    <div className="mb-12">
                        <p className="text-sm text-gray-400 mb-2">For inquiries, call us:</p>
                        <a
                            href={`tel:${club.ownerPhone}`}
                            className="text-2xl font-semibold text-gray-900 hover:text-gray-700 transition-colors"
                        >
                            {club.ownerPhone}
                        </a>
                    </div>
                )}

                <a
                    href="https://magic-nutrition-club.web.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-300 hover:text-gray-500 transition-colors"
                >
                    Powered by Magic Nutrition Club Platform
                </a>
            </div>
        </div>
    );
}

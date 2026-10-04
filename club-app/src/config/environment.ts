// Application Environment Configuration

export const ENV = {
    isDev: import.meta.env.DEV,
    isProd: import.meta.env.PROD,
    mode: import.meta.env.MODE,
    features: {
        analytics: import.meta.env.VITE_ENABLE_ANALYTICS === "true",
        mlm: import.meta.env.VITE_ENABLE_MLM === "true",
    },
    api: {
        cloudFunctionsBase: import.meta.env.VITE_FUNCTIONS_URL || "",
    },
    defaultClub: import.meta.env.VITE_DEV_CLUB_ID || "dev_club",
};

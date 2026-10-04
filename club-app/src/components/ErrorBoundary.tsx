import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-6 mx-auto">
                        <AlertTriangle className="w-10 h-10" />
                    </div>
                    <h1 className="text-3xl font-black text-slate-800 mb-4">Something went wrong</h1>
                    <p className="text-slate-500 mb-8 max-w-md mx-auto">
                        An unexpected error occurred. We've been notified.
                        You can try refreshing the page or returning home.
                    </p>

                    {this.state.error && (
                        <div className="bg-slate-100 p-4 rounded-xl text-left text-xs font-mono text-slate-600 w-full max-w-lg overflow-auto mb-8">
                            {this.state.error.toString()}
                        </div>
                    )}

                    <div className="flex gap-4 justify-center flex-wrap">
                        <Button onClick={this.handleReset} className="btn-premium gap-2">
                            <RefreshCw className="w-4 h-4" /> Refresh Page
                        </Button>
                        <Link to="/">
                            <Button variant="outline" className="btn-premium gap-2">
                                <Home className="w-4 h-4" /> Go Home
                            </Button>
                        </Link>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;

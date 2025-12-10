
import { type PropsWithChildren } from "react"
import { Link, useNavigate } from "react-router-dom"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { LogOut, Shield, Settings } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

import { ModeToggle } from "@/components/mode-toggle"

export function Layout({ children }: PropsWithChildren) {
    const { data: session, isPending } = authClient.useSession()
    const navigate = useNavigate()

    const handleLogout = async () => {
        await authClient.signOut()
        navigate("/login")
    }

    if (isPending) return <div className="flex h-screen items-center justify-center">Loading...</div>

    return (
        <div className="min-h-screen bg-background">
            <header className="border-b sticky top-0 z-40 bg-background/80 backdrop-blur-md">
                <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <Link to="/" className="font-bold text-xl tracking-tight">
                            Landing<span className="text-blue-600">Gen</span>
                        </Link>

                        {session?.user?.role === "admin" && (
                            <Link
                                to="/admin"
                                className="text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                            >
                                <Shield className="h-4 w-4" />
                                Admin
                            </Link>
                        )}
                    </div>

                    <div className="flex items-center gap-4">
                        <ModeToggle />
                        {session ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                                        <Avatar className="h-8 w-8">
                                            <AvatarImage src={session.user.image || undefined} alt={session.user.name} />
                                            <AvatarFallback>{session.user.name.charAt(0).toUpperCase()}</AvatarFallback>
                                        </Avatar>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-56" align="end" forceMount>
                                    <DropdownMenuLabel className="font-normal">
                                        <div className="flex flex-col space-y-1">
                                            <p className="text-sm font-medium leading-none">{session.user.name}</p>
                                            <p className="text-xs leading-none text-muted-foreground">
                                                {session.user.email}
                                            </p>
                                        </div>
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem asChild>
                                        <Link to="/settings" className="cursor-pointer">
                                            <Settings className="mr-2 h-4 w-4" />
                                            <span>Settings</span>
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={handleLogout}>
                                        <LogOut className="mr-2 h-4 w-4" />
                                        <span>Log out</span>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : (
                            <Button asChild variant="default" size="sm">
                                <Link to="/login">Log in</Link>
                            </Button>
                        )}
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8">
                {children}
            </main>
        </div>
    )
}

import { useState } from "react"
import { authClient } from "@/lib/auth-client"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useNavigate } from "react-router-dom"

export default function Signup() {
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [name, setName] = useState("Admin")
    const queryClient = useQueryClient()
    const navigate = useNavigate()

    const handleSignup = async () => {
        await authClient.signUp.email({
            email,
            password,
            name,
        }, {
            onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: ['hasUsers'] })
                navigate("/")
            },
            onError: (ctx) => {
                alert(ctx.error.message)
            }
        })
    }

    return (
        <div className="flex h-screen items-center justify-center">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <CardTitle className="text-2xl">First Time Setup</CardTitle>
                    <p className="text-sm text-gray-500">Create your admin account</p>
                </CardHeader>
                <CardContent className="grid gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Name</Label>
                        <Input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="password">Password</Label>
                        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                    </div>
                    <Button onClick={handleSignup} className="w-full">
                        Create Admin Account
                    </Button>
                </CardContent>
            </Card>
        </div>
    )
}

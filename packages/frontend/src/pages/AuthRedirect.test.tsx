import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ROUTES } from "@/app/router/paths"

const {
    signInEmailMock,
    signUpEmailMock,
    useUtilsMock,
    invalidateHasUsersMock,
    getDocsUrlMock,
    hardRedirectMock,
} = vi.hoisted(() => ({
    signInEmailMock: vi.fn(),
    signUpEmailMock: vi.fn(),
    useUtilsMock: vi.fn(),
    invalidateHasUsersMock: vi.fn(),
    getDocsUrlMock: vi.fn(),
    hardRedirectMock: vi.fn(),
}))

vi.mock("@/lib/auth-client", () => ({
    authClient: {
        signIn: {
            email: signInEmailMock,
        },
        signUp: {
            email: signUpEmailMock,
        },
    },
}))

vi.mock("@/lib/trpc", () => ({
    trpc: {
        useUtils: useUtilsMock,
    },
}))

vi.mock("@/lib/docsUrl", () => ({
    getDocsUrl: getDocsUrlMock,
}))

vi.mock("@/lib/hardRedirect", () => ({
    hardRedirect: hardRedirectMock,
}))

import Login from "./Login"
import Signup from "./Signup"

describe("auth success redirects", () => {
    beforeEach(() => {
        signInEmailMock.mockReset()
        signUpEmailMock.mockReset()
        useUtilsMock.mockReset()
        invalidateHasUsersMock.mockReset()
        getDocsUrlMock.mockReset()
        hardRedirectMock.mockReset()

        getDocsUrlMock.mockReturnValue("https://docs.vivd.studio/")
        invalidateHasUsersMock.mockResolvedValue(undefined)
        useUtilsMock.mockReturnValue({
            user: {
                hasUsers: {
                    invalidate: invalidateHasUsersMock,
                },
            },
        })

        signInEmailMock.mockImplementation(async (_input, handlers) => {
            await handlers?.onSuccess?.()
        })
        signUpEmailMock.mockImplementation(async (_input, handlers) => {
            await handlers?.onSuccess?.()
        })
    })

    it("hard redirects after login so session and app config rehydrate immediately", async () => {
        render(
            <MemoryRouter>
                <Login />
            </MemoryRouter>,
        )

        fireEvent.change(screen.getByLabelText("Email"), {
            target: { value: "admin@example.com" },
        })
        fireEvent.change(screen.getByLabelText("Password"), {
            target: { value: "password123" },
        })
        fireEvent.click(screen.getByRole("button", { name: "Login" }))

        await waitFor(() => {
            expect(signInEmailMock).toHaveBeenCalled()
            expect(hardRedirectMock).toHaveBeenCalledWith(ROUTES.DASHBOARD)
        })
    })

    it("hard redirects after first-time signup so super-admin navigation appears immediately", async () => {
        render(<Signup />)

        fireEvent.change(screen.getByLabelText("Name"), {
            target: { value: "Admin" },
        })
        fireEvent.change(screen.getByLabelText("Email"), {
            target: { value: "admin@example.com" },
        })
        fireEvent.change(screen.getByLabelText("Password"), {
            target: { value: "password123" },
        })
        fireEvent.click(screen.getByRole("button", { name: "Create Admin Account" }))

        await waitFor(() => {
            expect(signUpEmailMock).toHaveBeenCalled()
            expect(invalidateHasUsersMock).toHaveBeenCalled()
            expect(hardRedirectMock).toHaveBeenCalledWith(ROUTES.DASHBOARD)
        })
    })
})

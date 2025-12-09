import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../trpc";
import { processUrl } from "../generator/index";
import path from "path";
import fs from "fs";

export const projectRouter = router({
    generate: protectedProcedure
        .input(z.object({ url: z.string().min(1) }))
        .mutation(async ({ input }) => {
            const { url } = input;

            // Fire and forget processing
            processUrl(url).then(() => {
                console.log(`Finished processing ${url}`);
            }).catch(err => {
                console.error(`Error processing ${url}:`, err);
            });

            let targetUrl = url;
            if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
            const domainSlug = new URL(targetUrl).hostname.replace('www.', '').split('.')[0];

            return { status: 'processing', slug: domainSlug, message: "Generation started." };
        }),

    regenerate: protectedProcedure
        .input(z.object({ slug: z.string() }))
        .mutation(async ({ input }) => {
            const { slug } = input;
            const outputDir = path.join(__dirname, '../../generated', slug);

            if (!fs.existsSync(outputDir)) {
                throw new Error("Project not found");
            }

            const projectJsonPath = path.join(outputDir, 'project.json');
            if (!fs.existsSync(projectJsonPath)) {
                throw new Error("Project metadata not found (cannot regenerate legacy projects)");
            }

            const projectData = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
            const url = projectData.url;

            if (!url) {
                throw new Error("Original URL not found in project metadata");
            }

            // Delete contents
            fs.rmSync(outputDir, { recursive: true, force: true });
            
            // Fire and forget processing
            processUrl(url).then(() => {
                console.log(`Finished regenerating ${url}`);
            }).catch(err => {
                console.error(`Error regenerating ${url}:`, err);
            });

            return { status: 'processing', slug, message: "Regeneration started." };
        }),

    status: publicProcedure
        .input(z.object({ slug: z.string() }))
        .query(async ({ input }) => {
            const { slug } = input;
            // Note: Assuming the generated folder is at ../generated relative to src
            // server.ts has: path.join(__dirname, '../generated')
            // but here we are in src/routers, so it should be ../../generated
            const outputDir = path.join(__dirname, '../../generated', slug);

            if (fs.existsSync(path.join(outputDir, 'index.html'))) {
                return { status: 'completed', url: `/generated/${slug}/index.html` };
            } else {
                return { status: 'processing' };
            }
        }),

    list: publicProcedure.query(async () => {
        const generatedDir = path.join(__dirname, '../../generated');

        if (!fs.existsSync(generatedDir)) {
            return { projects: [] };
        }

        try {
            const files = fs.readdirSync(generatedDir, { withFileTypes: true });
            const projects = files
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);
            return { projects };
        } catch (error) {
            console.error("Failed to list projects:", error);
            throw new Error("Failed to list projects");
        }
    }),
});

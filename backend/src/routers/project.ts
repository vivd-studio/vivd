import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../trpc";
import { processUrl } from "../generator/index";
import path from "path";
import fs from "fs";


export const projectRouter = router({
    generate: protectedProcedure
        .input(z.object({
            url: z.string().min(1)
        }))
        .mutation(async ({ input }) => {
            const { url } = input;

            // Ensure consistent slug generation
            let targetUrl = url;
            if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
            const domainSlug = new URL(targetUrl).hostname.replace('www.', '').split('.')[0];
            const outputDir = path.join(process.cwd(), 'generated', domainSlug);

            if (fs.existsSync(outputDir)) {
                // Check status
                let status = 'unknown';
                const projectJsonPath = path.join(outputDir, 'project.json');
                if (fs.existsSync(projectJsonPath)) {
                    try {
                        const projectData = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
                        status = projectData.status || 'unknown';
                    } catch (e) {
                        console.error(`Error reading metadata for ${domainSlug}`, e);
                    }
                } else if (fs.existsSync(path.join(outputDir, 'index.html'))) {
                    status = 'completed';
                }

                if (status === 'processing' || status === 'scraping' || status === 'analyzing_images' || status === 'creating_hero' || status === 'generating_html') {
                    // It is processing
                    throw new Error("Project is currently being generated");
                }

                return { status: 'exists', slug: domainSlug, message: "Project already exists" };
            }

            // Fire and forget processing
            processUrl(url).then(() => {
                console.log(`Finished processing ${url}`);
            }).catch(err => {
                console.error(`Error processing ${url}:`, err);
            });

            return { status: 'processing', slug: domainSlug, message: "Generation started." };
        }),

    regenerate: protectedProcedure
        .input(z.object({ slug: z.string() }))
        .mutation(async ({ input }) => {
            const { slug } = input;
            const outputDir = path.join(process.cwd(), 'generated', slug);

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
            const generatedDir = path.join(process.cwd(), 'generated');
            const projectJsonPath = path.join(generatedDir, slug, 'project.json');

            let status = 'processing';
            let originalUrl = '';
            let createdAt = '';

            if (fs.existsSync(projectJsonPath)) {
                try {
                    const projectData = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
                    if (projectData.status) status = projectData.status;
                    if (projectData.url) originalUrl = projectData.url;
                    if (projectData.createdAt) createdAt = projectData.createdAt;
                } catch (e) {
                    console.error(`Error reading metadata for ${slug}`, e);
                }
            } else if (fs.existsSync(path.join(generatedDir, slug, 'index.html'))) {
                // Fallback for very old legacy projects without json
                status = 'completed';
            }

            const resultUrl = status === 'completed' ? `/generated/${slug}/index.html` : undefined;

            return {
                status,
                url: resultUrl,
                originalUrl,
                createdAt
            };
        }),

    list: publicProcedure.query(async () => {
        const generatedDir = path.join(process.cwd(), 'generated');

        if (!fs.existsSync(generatedDir)) {
            return { projects: [] };
        }

        try {
            const files = fs.readdirSync(generatedDir, { withFileTypes: true });
            const projects = files
                .filter(dirent => dirent.isDirectory())
                .map(dirent => {
                    const projectSlug = dirent.name;
                    const projectJsonPath = path.join(generatedDir, projectSlug, 'project.json');
                    let status = 'unknown'; // Default for legacy projects

                    let url = '';
                    let createdAt = '';

                    if (fs.existsSync(projectJsonPath)) {
                        try {
                            const projectData = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
                            if (projectData.status) status = projectData.status;
                            if (projectData.url) url = projectData.url;
                            if (projectData.createdAt) createdAt = projectData.createdAt;
                        } catch (e) {
                            console.error(`Error reading metadata for ${projectSlug}`, e);
                        }
                    }

                    return {
                        slug: projectSlug,
                        status,
                        url,
                        createdAt
                    };
                });
            return { projects };
        } catch (error) {
            console.error("Failed to list projects:", error);
            throw new Error("Failed to list projects");
        }
    }),
});

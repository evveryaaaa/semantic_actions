module.exports = async ({github, context, core, glob}) => {

    async function calculateLastPrerelease(tag_name) {

        try {
            for await (const response of github.paginate.iterator(
                github.rest.repos.listTags,
                {
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                }
            )) {
                const regex = RegExp(`^${tag_name}-[0-9]+$`);
                const latest_tag = response.data.find((tag) => { return regex.test(tag.name) });
                if (latest_tag) {
                    return Number(latest_tag.name.split('-').pop());
                }
            }
            return 0;
    
        } catch (error) {
            core.info("Unexpected error fetching exisitng releases and generating prerelease suffix");
            throw error;
        }
    
    }
    
    async function createRelease(owner, repo, tag_name, last_prerelease, target_commitish, prerelease, max_suffix_increase = 3, name, body, draft, discussion_category_name, generate_release_notes) {
    
        if (max_suffix_increase <= 0) {
            core.info("Too many suffix increase retries. Aborting...");
            throw new Error("Too many suffix increases.");
        }
    
        try {
    
            const release = await github.rest.repos.createRelease({
                owner: owner,
                repo: repo,
                tag_name: prerelease ? `${tag_name}-${last_prerelease + 1}` : tag_name,
                target_commitish: target_commitish,
                prerelease: prerelease,
                name: name,
                body: body,
                draft: draft,
                discussion_category_name: discussion_category_name,
                generate_release_notes: generate_release_notes
            });
    
            return release;
    
        } catch (error) {


            
            if (error.status === 422 && error.response.data.errors?.find((error) => error.resource === "Release" && error.code === "already_exists" && error.field === "tag_name") && prerelease) {
                core.warning("The generated prerelease suffix already exists, retrying with a higher suffix");
                return createRelease(owner, repo, tag_name, last_prerelease + 1, target_commitish, prerelease, max_suffix_increase - 1, name, body, draft, discussion_category_name, generate_release_notes);
            } else if (error.status === 422 && error.response.data.errors?.find((error) => error.resource === "Release" && error.code === "already_exists" && error.field === "tag_name") && !prerelease) {
                throw new Error('The generated release already exists')
            }

            core.info("There has been an issue tagging and publishing the release");
            throw error;
        }
    
    
    }
    
    async function uploadAssets(release_id){
    
        // Search glob matching files and try to upload them
    
        const globber = await glob.create(process.env.files);
    
        const path = require('path');
    
        const fs = require('fs');
    
        try {
            for await (const file of globber.globGenerator()) {
    
                const name = path.basename(file);
    
                const file_type = "application/octet-stream";
    
                const data = fs.readFileSync(file);
    
                await github.rest.repos.uploadReleaseAsset({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    release_id: release_id,
                    name: name,
                    data: data,
                    headers: {
                        "content-type": file_type
                    }
                });
            }
    
        } catch (error) {
    
            core.info('There has been an issue uploading the provided glob patterned files');
            throw error;
    
        }
        
    }
    
    try {
    
        const prerelease_validation = process.env.prerelease.toUpperCase();
        const draft_validation = process.env.draft.toUpperCase();
        const generate_release_notes_validation = process.env.draft.toUpperCase();
    
        // Check supported release types
        if (prerelease_validation !== 'TRUE' && prerelease_validation !== 'FALSE') {
            throw new Error("Invalid prerelease input (valid options: 'true', 'false', 'TRUE', 'FALSE'");
        } else if (draft_validation !== 'TRUE' && draft_validation !== 'FALSE') {
            throw new Error("Invalid draft input (valid options: 'true', 'false', 'TRUE', 'FALSE'");
        } else if (generate_release_notes_validation !== 'TRUE' && generate_release_notes_validation !== 'FALSE') {
            throw new Error("Invalid generate_release_notes input (valid options: 'true', 'false', 'TRUE', 'FALSE'");
        }

        const draft = draft_validation === 'TRUE';
        core.info(`This action was set ${draft ? 'generate a unpublished draft' : 'make a release publication'}`);
    
        const prerelease = prerelease_validation === 'TRUE';
        core.info(`This action was set to publish a ${prerelease ? 'prerelease' : 'release'}`);

        const generate_release_notes = generate_release_notes_validation === 'TRUE';
        core.info(`This action was set to ${generate_release_notes ? '' : 'not'} automatically genrate release notes`);

        const tag_name = process.env.tag_name;
    
        // Calculate pre-release suffix based on retrieved list from API
        let last_prerelease = 0;
    
        if (prerelease) {
            last_prerelease = await calculateLastPrerelease(tag_name);
        }
    
        //Create release and retrying 3 times with higher prerelease suffix if it already exists
        const release = await createRelease(context.repo.owner, context.repo.repo, tag_name, last_prerelease, process.env.target_commitish, prerelease, Number(core.getInput("retries")), process.env.name || undefined , process.env.body || undefined, draft, process.env.discussion_category_name || undefined, generate_release_notes);
        
        console.log(JSON.stringify(release));
        //Upload release assets
        await uploadAssets(release.data.id);

        core.setOutput("tag_name", release.tag_name);
    
    } catch (error) {
        core.setFailed(error);
    }

}



// MIT License - Copyright (c) 2020 Stefan Arentz <stefan@devbots.xyz>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.


const fs = require('fs');

const core = require('@actions/core');
const execa = require('execa');
const plist = require('plist');


// TODO This now lives in two actions, so maybe it should be factored out.
const getProjectInfo = async ({workspace, project}) => {
    const options = [];
    if (workspace != "") {
        options.push("-workspace", workspace);
    }
    if (project != "") {
        options.push("-project", project);
    }

    const xcodebuild = execa('xcodebuild', [...options, '-list', '-json']);
    const {stdout} = await xcodebuild;

    return JSON.parse(stdout);
};


// TODO Right now this code is completely assuming macOS and automatic
// code signing. What we should do is look at the xcarchive to understand
// what we are exporting and then set sensible defaults. And have more
// configurability on the action of course.
//
// Other things we can do: preflight the export to make sure everything
// is in place that we need (like the right certificates). Then we do
// not have to deal with cryptic errors that come out of xcodebuild.


const exportArchive = async ({archivePath, exportMethod, exportPath}) => {
    // Write the exportOptions.plist

    const exportOptions = {
        method: exportMethod,
    };

    // TODO This should probably be stored in some temporary directory
    fs.writeFileSync("exportOptions.plist", plist.build(exportOptions));

    // Execute xcodebuild -exportArchive

    const args = [
        "-exportArchive",
        "-archivePath", archivePath,
        "-exportPath", exportPath,
        "-exportOptionsPlist", "exportOptions.plist",
    ];

    const xcodebuild = execa('xcodebuild', args);
    xcodebuild.stdout.pipe(process.stdout);
    xcodebuild.stderr.pipe(process.stderr);

    await xcodebuild;
};


const parseConfiguration = async () => {
    const configuration = {
        workspace: core.getInput("workspace"),
        project: core.getInput("project"),
        scheme: core.getInput("scheme"),
        archivePath: core.getInput("archive-path"),
        exportPath: core.getInput("export-path", {required: true}),
        exportMethod: core.getInput("export-method", {required: true}), // TODO
    };

    // If the scheme or archivePath is not provided then we discover it

    if (configuration.scheme === "" || configuration.archivePath === "") {
        const projectInfo = await getProjectInfo(configuration);

        if (configuration.scheme === "") {
            configuration.scheme = projectInfo.project.schemes[0];
        }

        if (configuration.archivePath === "") {
            configuration.archivePath = configuration.scheme + ".xcarchive";
        }
    }

    const ValidExportMethods = [
        // "app-store",
        // "validation",
        // "ad-hoc",
        // "package",
        // "enterprise",
        "development",
        "developer-id",
        // "mac-application"
    ];

    if (!ValidExportMethods.includes(configuration.exportMethod)) {
        throw Error(`Export method ${configuration.exportMethod} is invalid.`);
    }

    if (!fs.existsSync(configuration.archivePath)) {
        throw Error(`Archive path ${configuration.archivePath} does not exist.`);
    }

    // Parse the Info.plist in the xcarchive to make sure this is an
    // application archive, which is the only archive we know how to
    // handle right now.

    const archiveInfo = plist.parse(fs.readFileSync(configuration.archivePath + "/Info.plist", "utf8"));
    if (!archiveInfo.hasOwnProperty("ApplicationProperties")) {
        throw Error(`Archive ${configuration.archivePath} is not an Application Archive`);
    }

    return configuration;
};


const main = async () => {
    try {
        const configuration = await parseConfiguration();

        try {
            await core.group('Export Archive', async () => {
                await exportArchive(configuration)
            });
        } catch (error) {
            core.error(`Unexpected error during Export Archive: ${error.message}`);
            throw error;
        }

        // TODO Set outputs (product-name, product-path)
    } catch (error) {
        core.setFailed(`Export Archive failed with unexpected error: ${error.message}`);
    }
};


main();

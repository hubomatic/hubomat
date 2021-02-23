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


const core = require('@actions/core');
const execa = require('execa');


// TODO Unclear if clean needs all these options
const clean = async ({workspace, project, scheme, configuration}) => {
    const options = [];
    if (workspace != "") {
        options.push("-workspace", workspace);
    }
    if (project != "") {
        options.push("-project", project);
    }
    if (scheme != "") {
        options.push("-scheme", scheme);
    }
    if (configuration != "") {
        options.push("-configuration", configuration);
    }

    const args = [
        ...options,
        "clean"
    ];

    const xcodebuild = execa('xcodebuild', args);
    xcodebuild.stdout.pipe(process.stdout);
    xcodebuild.stderr.pipe(process.stderr);

    await xcodebuild;
};


const archive = async ({workspace, project, scheme, configuration, archivePath}) => {
    const options = [];
    if (workspace != "") {
        options.push("-workspace", workspace);
    }
    if (project != "") {
        options.push("-project", project);
    }
    if (scheme != "") {
        options.push("-scheme", scheme);
    }
    if (configuration != "") {
        options.push("-configuration", configuration);
    }

    const archiveOptions = [];
    if (archivePath != "") {
        archiveOptions.push("-archivePath", archivePath);
    }

    const buildSettings = [
        "COMPILER_INDEX_STORE_ENABLE=NO"
    ];

    const args = [
        ...options,
        "archive",
        ...archiveOptions,
        ...buildSettings
    ];

    const xcodebuild = execa('xcodebuild', args);
    xcodebuild.stdout.pipe(process.stdout);
    xcodebuild.stderr.pipe(process.stderr);

    await xcodebuild;
};


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


const parseConfiguration = async () => {
    const configuration = {
        workspace: core.getInput("workspace"),
        project: core.getInput("project"),
        scheme: core.getInput("scheme"),
        configuration: core.getInput("configuration"),
        archivePath: core.getInput("archive-path"),
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

    return configuration;
};


const main = async () => {
    try {
        const configuration = await parseConfiguration();

        if (configuration.cleanBuild === true) {
            try {
                await core.group('Clean', async () => {
                    await clean(configuration)
                });
            } catch (error) {
                core.error(`Unexpected error during Clean: ${error.message}`);
                throw error;
            }
        }

        try {
            await core.group('Archive', async () => {
                await archive(configuration)
            });
        } catch (error) {
            core.error(`Unexpected error during Archive: ${error.message}`);
            throw error;
        }

        core.setOutput('archive-path', configuration.archivePath);
    } catch (error) {
        core.setFailed(`Archive failed with unexpected error: ${error.message}`);
    }
};


main();

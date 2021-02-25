// MIT License - Copyright (c) 2020 Stefan Arentz <stefan@devbots.xyz>
// MIT License - Copyright (c) 2021 Marc Prud'hommeaux <marc@glimpse.io>
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

// To make a new release, run: npm install && git.tagrelease

const fs = require("fs");
const path = require('path');
const core = require('@actions/core');
const execa = require('execa');
const plist = require('plist');
const {config} = require('process');


const sleep = (ms) => {
    return new Promise(res => setTimeout(res, ms));
};

// Taken from sysexits.h and the stapler man page
const staplerExitCodes = {
    /* EX_USAGE     */ 64: "Options appear malformed or are missing.",
    /* EX_NOINPUT   */ 66: "The path cannot be found, is not code-signed, or is not of a supported file format, or, if the validate option is passed, the existing ticket is missing or invalid.",
    /* EX_DATAERR   */ 65: "The ticket data is invalid.",
    /* EX_NOPERM    */ 77: "The ticket has been revoked by the ticketing service.",
    /* EX_NOHOST    */ 68: "The path has not been previously notarized or the ticketing service returns an unexpected response.",
    /* EX_CANTCREAT */ 73: "The ticket has been retrieved from the ticketing service and was properly validated but the ticket could not be written out to disk."
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

        archivePath: core.getInput("archive-path"),
        productPath: core.getInput("product-path", {required: true}),

        exportPath: core.getInput("export-path", {required: true}),
        tmpPath: core.getInput("temp-path", {required: false}),

        artifactPath: core.getInput("artifact-path", {required: false}),
        exportMethod: core.getInput("export-method", {required: true}), 

        username: core.getInput("appstore-connect-username", {required: true}),
        password: core.getInput("appstore-connect-password", {required: true}),
        teamID: core.getInput("team-id", {required: true}),

        primaryBundleId: core.getInput("primary-bundle-id"),

        timeout: core.getInput("timeout") || 60,
        verbose: core.getInput("verbose") === "true",
        staple: (core.getInput("staple") || "true") === "true",
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

    return configuration;
};

const importCertificates = async () => {
    try {
        const tempdir = core.getInput("temp-path") || `/tmp`;
        const keychainName = core.getInput("keychain-name") || `hubomat-xcode-certificates-${process.env.GITHUB_REPOSITORY}`;
        const keychainPassword = core.getInput("keychain-password", {required: true});
        const keychainPath = path.join(process.env.HOME, "Library/Keychains", keychainName + "-db");

        // Setup the keychain if it does not exist yet

        if (!fs.existsSync(keychainPath)) {
            const setupCommands = [
                ['security', ['create-keychain', '-p', keychainPassword, keychainName]],
            ];

            for (const command of setupCommands) {
                await execa(command[0], command[1]);
            }
        }

        // Import the certificate

        let certificatePath = core.getInput('certificate-path');
        if (certificatePath === "") {
            const certificateData = core.getInput('certificate-data', {required: true});
            const buffer = Buffer.from(certificateData, 'base64');
            certificatePath = `${tempdir}/certificate.p12`;
            fs.writeFileSync(certificatePath, buffer);
        }

        const certificatePassphrase = core.getInput('certificate-passphrase', {required: true});

        const importCommands = [
            ['security', ['default-keychain', '-s', keychainName]],
            ['security', ['unlock-keychain', '-p', keychainPassword, keychainName]],
            ['security', ['import', certificatePath, '-f', 'pkcs12', '-k', keychainName, '-P', certificatePassphrase, '-T', '/usr/bin/codesign', '-x' ]],
            ['security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', keychainPassword, keychainName]]
        ]

        for (const command of importCommands) {
            await execa(command[0], command[1]);
        }

        core.setOutput("keychain-name", keychainName);
    } catch (error) {
        core.setFailed(error.message);
        throw error;
    } finally {
        if (fs.existsSync(`${tempdir}/certificate.p12`)) {
            fs.unlinkSync(`${tempdir}/certificate.p12`);
        }
    }
};

const exportArchive = async ({archivePath, exportMethod, exportPath, teamID, verbose}) => {
    // Write the exportOptions.plist

    const exportOptions = {
        method: exportMethod,
        teamID: teamID,
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

    if (verbose === true) {
        args.push("-verbose");
    }

    const xcodebuild = execa('xcodebuild', args);

    xcodebuild.stdout.pipe(process.stdout);
    xcodebuild.stderr.pipe(process.stderr);

    await xcodebuild;
};



const verifySignature = async ({productPath, verbose}) => {
    const args = [
        "--deep",
    ];

    if (verbose === true) {
        args.push("--verbose");
    }

    args.push("--verify");
    args.push(productPath);

    let xcrun = execa("/usr/bin/codesign", args, {reject: false});

    if (verbose == true) {
        xcrun.stdout.pipe(process.stdout);
        xcrun.stderr.pipe(process.stderr);
    }

    const {exitCode} = await xcrun;

    if (exitCode != 0) {
        throw Error(`Error checking signature: ${exitCode}`);
    }

};

const verifyGatekeeper = async ({productPath, verbose}) => {
    const args = [
        "-a",
        "-t",
        "exec",
        "-vv",
    ];

    if (verbose === true) {
        args.push("--verbose");
    }

    args.push(productPath);

    let xcrun = execa("/usr/sbin/spctl", args, {reject: false});

    if (verbose == true) {
        xcrun.stdout.pipe(process.stdout);
        xcrun.stderr.pipe(process.stderr);
    }

    const {exitCode} = await xcrun;

    if (exitCode != 0) {
        throw Error(`Error checking security policy: ${exitCode}`);
    }

};

const createZip = async ({productPath, archivePath}) => {
    const args = [
        "-c",           // Create an archive at the destination path
        "-k",           // Create a PKZip archive
        "--keepParent", // Embed the parent directory name src in dst_archive.
        productPath,    // Source
        archivePath,    // Destination
    ];

    try {
        await execa("ditto", args);
    } catch (error) {
        core.error(error);
        return null;
    }

    return archivePath;
};


const notarize = async ({submitPath, productPath, primaryBundleId, username, password, verbose}) => {
    //
    // Make sure the product exists.
    //

    if (!fs.existsSync(productPath)) {
        throw Error(`No productPath could be found at ${productPath}`);
    }

    if (!fs.existsSync(submitPath)) {
        throw Error(`No submitPath could be found at ${submitPath}`);
    }

    //
    // The notarization process requires us to submit a 'primary
    // bundle id' - this is just a unique identifier for notarizing
    // this specific product. If it is not provided then we simply
    // use the actual bundle identifier from the Info.plist
    //

    if (typeof primaryBundleId !== 'string' || primaryBundleId === '') {
        const path = productPath + "/Contents/Info.plist";
        if (fs.existsSync(path)) {
            const info = plist.parse(fs.readFileSync(path, "utf8"));
            primaryBundleId = info.CFBundleIdentifier;
        }
    }


    if (typeof primaryBundleId !== 'string') {
        throw Error("Missing primary-bundle-id.");
    }

    if (primaryBundleId === '') {
        throw Error("Empty primary-bundle-id.");
    }

    //
    // Run altool to notarize this application. This only submits the
    // application to the queue on Apple's server side. It does not
    // actually tell us if the notarization was succesdful or not, for
    // that we need to poll using the request UUID that is returned.
    //

    core.info(`notarizing bundle ID: ${primaryBundleId}`);

    const args = [
        "altool",
        "--output-format", "json",
        "--notarize-app",
        "-f", submitPath,
        "--primary-bundle-id", primaryBundleId,
        "-u", username,
        "-p", password
    ];

    if (verbose === true) {
        args.push("--verbose");
    }

    let xcrun = execa("xcrun", args, {reject: false});

    if (verbose == true) {
        xcrun.stdout.pipe(process.stdout);
        xcrun.stderr.pipe(process.stderr);
    }

    const {exitCode, stdout, stderr} = await xcrun;

    if (exitCode === undefined) {
        // TODO Command did not run at all
        throw Error("Unknown failure - altool did not run at all?");
    }

    if (exitCode !== 0) {
        // TODO Maybe print stderr - see where that ends up in the output? console.log("STDERR", stderr);
        const response = JSON.parse(stdout);
        if (verbose === true) {
            console.log(response);
        }

        for (const productError of response["product-errors"]) {
            core.error(`${productError.code} - ${productError.message}`);
        }
        return null;
    }

    const response = JSON.parse(stdout);
    if (verbose === true) {
        console.log(response);
    }

    return response["notarization-upload"]["RequestUUID"];
};


const pollstatus = async ({uuid, username, password, verbose, timeout}) => {
    const args = [
        "altool",
        "--output-format", "json",
        "--notarization-info",
        uuid,
        "-u", username,
        "-p", password
    ];

    if (verbose === true) {
        args.push("--verbose");
    }

    for (let i = 0; i < timeout; i++) { // 45-90 seconds each check, so it averages to the given timeout minutes
        let xcrun = execa("xcrun", args, {reject: false});

        if (verbose == true) {
            xcrun.stdout.pipe(process.stdout);
            xcrun.stderr.pipe(process.stderr);
        }

        const {exitCode, stdout, stderr} = await xcrun;

        if (exitCode === undefined) {
            // TODO Command did not run at all
            throw Error("Unknown failure - altool did not run at all?");
        }

        if (exitCode !== 0) {
            // TODO Maye print stderr - see where that ends up in the output? console.log("STDERR", stderr);
            const response = JSON.parse(stdout);
            if (verbose === true) {
                console.log(response);
            }

            for (const productError of response["product-errors"]) {
                core.error(`${productError.code} - ${productError.message}`);
            }
            return false;
        }

        const response = JSON.parse(stdout);
        if (verbose === true) {
            console.log(response);
        }

        const notarizationInfo = response["notarization-info"];
        switch (notarizationInfo["Status"]) {
            case "in progress":
                core.info(`Notarization status <in progress>`);
                break;
            case "invalid":
                core.error(`Notarization status <invalid> - ${notarizationInfo["Status Message"]}`);
                return false;
            case "success":
                core.info(`Notarization status <success>`);
                return true;
            default:
                core.error(`Notarization status <${notarizationInfo["Status"]}> - TODO`);
                return false;
        }

        // wait between 45-90 seconds between polls
        await sleep(((Math.random() * 45) + 45) * 1000);
    }

    core.error(`Failed to get final notarization status after ${timeout} minutes.`);

    return false;
};

const staple = async ({productPath, verbose}) => {
    const options = [verbose === true ? "--verbose" : "--quiet"];
    let {exitCode} = await execa("xcrun", ["stapler", "staple", ...options, productPath], {reject: false});
    if (exitCode != 0) {
        const message = staplerExitCodes[exitCode] || `Unknown exit code ${exitCode}`;
        throw Error(`Staple failed: ${message}`);
    }

};

const main = async () => {
    try {
        const configuration = await parseConfiguration();

        try {
            await core.group('Importing Signing Certificates', async () => {
                await importCertificates();
            });
        } catch (error) {
            core.error(`Unexpected error during import certificates: ${error.message}`);
            throw error;
        }

        try {
            await core.group('Exporting Archive', async () => {
                await exportArchive({ archivePath: configuration.archivePath, exportMethod: configuration.exportMethod, exportPath: configuration.exportPath, teamID: configuration.teamID, verbose: configuration.verbose })

                await verifySignature({ productPath: configuration.productPath, verbose: configuration.verbose });
            });
        } catch (error) {
            core.error(`Unexpected error during Export Archive: ${error.message}`);
            throw error;
        }

        try {
            await core.group('Validating Archive', async () => {
                // the product should be exported, either manually or via the previous step
                if (!fs.existsSync(configuration.productPath)) {
                    throw Error(`Product path ${configuration.productPath} does not exist.`);
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

            });
        } catch (error) {
            core.error(`Unexpected error during Export Archive: ${error.message}`);
            throw error;
        }

        const submitZipPath = await core.group('Preparing for Notarization', async () => {
            const tempdir = core.getInput("temp-path") || `/tmp`;
            const zipPath = await createZip({productPath: configuration.productPath, archivePath: `${tmpdir}/archive.zip`});

            if (zipPath !== null) {
                core.info(`Created application archive at ${zipPath}`);
            }
            return zipPath;
        });


        const uuid = await core.group('Submitting for Notarization', async () => {
            let uuid = await notarize({submitPath: submitZipPath, productPath: configuration.productPath, ...configuration});
            if (uuid !== null) {
                core.info(`Submitted package for notarization. Request UUID is ${uuid}`);
            }
            return uuid;
        });

        if (uuid == null) {
            core.setFailed("Notarization failed");
            return;
        }

        await sleep(30 * 1000); // initial wait for the app to enter the system
        core.info(`Checking status for archive ${configuration.archivePath}`);

        const success = await core.group('Waiting for Notarization Status', async () => {
            return await pollstatus({uuid: uuid, ...configuration})
        });

        if (success == false) {
            core.setFailed("Notarization failed");
            return;
        }

        core.setOutput('product-path', configuration.productPath);

        if (configuration.staple === true) {
            await staple({productPath: configuration.productPath, verbose: configuration.verbose});
            core.info(`Stapeled notarization ticket to ${configuration.productPath}`);

            await verifyGatekeeper({productPath: configuration.productPath, verbose: configuration.verbose});
            core.info(`Verified security policy for ${configuration.productPath}`);
        }

        if (configuration.artifactPath) {
            await createZip({ productPath: configuration.productPath, archivePath: configuration.artifactPath });
            core.info(`Zipped notarized app to ${configuration.artifactPath}`);
        }
    } catch (error) {
        core.setFailed(`HubOMatic failed with an unexpected error: ${error.message}`);
    }
};


main();


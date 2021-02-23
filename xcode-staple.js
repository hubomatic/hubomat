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


//
// TODO Not sure what to do with the following: "If an executable
// bundle contains a symlink at Contents/CodeResources, it must be
// manually deleted before staple will function."
//
// TODO If verbose, also capture the logs and print to console.
//


const core = require('@actions/core');
const execa = require('execa');


// Taken from sysexits.h and the stapler man page
const staplerExitCodes = {
    /* EX_USAGE     */ 64: "Options appear malformed or are missing.",
    /* EX_NOINPUT   */ 66: "The path cannot be found, is not code-signed, or is not of a supported file format, or, if the validate option is passed, the existing ticket is missing or invalid.",
    /* EX_DATAERR   */ 65: "The ticket data is invalid.",
    /* EX_NOPERM    */ 77: "The ticket has been revoked by the ticketing service.",
    /* EX_NOHOST    */ 68: "The path has not been previously notarized or the ticketing service returns an unexpected response.",
    /* EX_CANTCREAT */ 73: "The ticket has been retrieved from the ticketing service and was properly validated but the ticket could not be written out to disk."
};


const parseConfiguration = () => {
    return {
        verbose: core.getInput("verbose") === "true",
        productPath: core.getInput("product-path", {required: true})
    };
};


const staple = async ({productPath, verbose}) => {
    const options = [verbose ? "--verbose" : "--quiet"];
    let {exitCode} = await execa("xcrun", ["stapler", "staple", ...options, productPath], {reject: false});
    if (exitCode != 0) {
        const message = staplerExitCodes[exitCode] || `Unknown exit code ${exitCode}`;
        throw Error(`Staple failed: ${message}`);
    }
};


const main = async () => {
    try {
        const configuration = parseConfiguration();
        await staple(configuration);
    } catch (error) {
        core.setFailed(`Stapling failed with an unexpected error: ${error.message}`);
    }
};


main();

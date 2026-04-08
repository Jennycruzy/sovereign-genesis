const OpenAI = require('openai');
const { Octokit } = require('@octokit/rest');
const logger = require('./logger');

class Judge {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        this.github = new Octokit({
            auth: process.env.GITHUB_TOKEN
        });
    }

    async reviewPR(owner, repo, prNumber) {
        const startTime = Date.now();
        logger.info(`Starting PR review for ${owner}/${repo}#${prNumber}`);
        
        try {
            // Check CI status
            const ciStatus = await this.checkCIStatus(owner, repo, prNumber);
            logger.info(`CI status for PR #${prNumber}: ${ciStatus}`, {
                owner,
                repo,
                prNumber,
                ciStatus
            });

            if (ciStatus === 'failure') {
                logger.warn(`PR #${prNumber} failed CI checks`, {
                    owner,
                    repo,
                    prNumber,
                    reason: 'ci_failure'
                });
                return {
                    verdict: 'FAIL',
                    reason: 'CI checks failed'
                };
            }

            // Get PR diff
            const diff = await this.getPRDiff(owner, repo, prNumber);
            logger.info(`Retrieved diff for PR #${prNumber}, size: ${diff.length} characters`, {
                owner,
                repo,
                prNumber,
                diffSize: diff.length
            });

            // AI review
            const aiVerdict = await this.performAIReview(diff, owner, repo, prNumber);
            
            const duration = Date.now() - startTime;
            logger.info(`PR review completed for ${owner}/${repo}#${prNumber}`, {
                owner,
                repo,
                prNumber,
                verdict: aiVerdict.verdict,
                duration: `${duration}ms`,
                ciStatus
            });

            return aiVerdict;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(`Critical error during PR review for ${owner}/${repo}#${prNumber}`, {
                owner,
                repo,
                prNumber,
                error: {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                    code: error.code
                },
                duration: `${duration}ms`,
                timestamp: new Date().toISOString()
            });
            
            // Return fail verdict on any error to be safe
            return {
                verdict: 'FAIL',
                reason: `Review failed due to system error: ${error.message}`
            };
        }
    }

    async checkCIStatus(owner, repo, prNumber) {
        try {
            logger.info(`Checking CI status for ${owner}/${repo}#${prNumber}`);
            
            const { data: pr } = await this.github.pulls.get({
                owner,
                repo,
                pull_number: prNumber
            });

            const { data: checks } = await this.github.checks.listForRef({
                owner,
                repo,
                ref: pr.head.sha
            });

            logger.info(`Found ${checks.check_runs.length} check runs for PR #${prNumber}`, {
                owner,
                repo,
                prNumber,
                sha: pr.head.sha,
                checkCount: checks.check_runs.length
            });

            if (checks.check_runs.length === 0) {
                logger.info(`No CI checks found for PR #${prNumber}, assuming success`, {
                    owner,
                    repo,
                    prNumber
                });
                return 'success';
            }

            const failedChecks = checks.check_runs.filter(check => check.conclusion === 'failure');
            if (failedChecks.length > 0) {
                logger.warn(`PR #${prNumber} has ${failedChecks.length} failed checks`, {
                    owner,
                    repo,
                    prNumber,
                    failedChecks: failedChecks.map(check => ({
                        name: check.name,
                        conclusion: check.conclusion,
                        status: check.status
                    }))
                });
                return 'failure';
            }

            return 'success';

        } catch (error) {
            logger.error(`Error checking CI status for ${owner}/${repo}#${prNumber}`, {
                owner,
                repo,
                prNumber,
                error: {
                    message: error.message,
                    status: error.status,
                    response: error.response?.data
                }
            });
            
            // On error, assume CI passed to not block valid PRs
            return 'success';
        }
    }

    async getPRDiff(owner, repo, prNumber) {
        try {
            logger.info(`Fetching diff for ${owner}/${repo}#${prNumber}`);
            
            const { data: diff } = await this.github.pulls.get({
                owner,
                repo,
                pull_number: prNumber,
                mediaType: {
                    format: 'diff'
                }
            });

            logger.info(`Successfully retrieved diff for PR #${prNumber}`, {
                owner,
                repo,
                prNumber,
                diffLength: diff.length
            });

            return diff;

        } catch (error) {
            logger.error(`Error fetching diff for ${owner}/${repo}#${prNumber}`, {
                owner,
                repo,
                prNumber,
                error: {
                    message: error.message,
                    status: error.status,
                    response: error.response?.data
                }
            });
            throw error;
        }
    }

    async performAIReview(diff, owner, repo, prNumber) {
        try {
            logger.info(`Starting AI review for ${owner}/${repo}#${prNumber}`, {
                owner,
                repo,
                prNumber,
                diffSize: diff.length
            });

            const prompt = `
You are an AI code reviewer for a bounty system. Review this PR diff and determine if it meets basic quality standards.

Criteria:
- Code should compile/run without obvious syntax errors
- Should address the bounty requirements
- No malicious or harmful code
- Basic code quality standards

Respond with either "PASS" or "FAIL" followed by a brief reason.

Diff:
${diff}
`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 500,
                temperature: 0.1
            });

            const aiResponse = response.choices[0].message.content;
            logger.info(`AI review completed for PR #${prNumber}`, {
                owner,
                repo,
                prNumber,
                aiResponse,
                tokensUsed: response.usage?.total_tokens
            });

            const verdict = aiResponse.toUpperCase().includes('PASS') ? 'PASS' : 'FAIL';
            
            logger.info(`AI verdict for PR #${prNumber}: ${verdict}`, {
                owner,
                repo,
                prNumber,
                verdict,
                fullResponse: aiResponse
            });

            return {
                verdict,
                reason: aiResponse
            };

        } catch (error) {
            logger.error(`Error during AI review for ${owner}/${repo}#${prNumber}`, {
                owner,
                repo,
                prNumber,
                error: {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                    code: error.code,
                    type: error.type,
                    status: error.status
                },
                openaiError: {
                    type: error.type,
                    code: error.code,
                    param: error.param
                }
            });
            throw error;
        }
    }

    async postReviewComment(owner, repo, prNumber, verdict, reason) {
        try {
            logger.info(`Posting review comment for ${owner}/${repo}#${prNumber}`, {
                owner,
                repo,
                prNumber,
                verdict
            });

            const comment = `🤖 **AI Judge Review: ${verdict}**\n\n${reason}`;
            
            await this.github.pulls.createReview({
                owner,
                repo,
                pull_number: prNumber,
                body: comment,
                event: verdict === 'PASS' ? 'APPROVE' : 'REQUEST_CHANGES'
            });

            logger.info(`Review comment posted successfully for PR #${prNumber}`, {
                owner,
                repo,
                prNumber,
                verdict
            });

        } catch (error) {
            logger.error(`Error posting review comment for ${owner}/${repo}#${prNumber}`, {
                owner,
                repo,
                prNumber,
                verdict,
                error: {
                    message: error.message,
                    status: error.status,
                    response: error.response?.data
                }
            });
            throw error;
        }
    }
}

module.exports = new Judge();
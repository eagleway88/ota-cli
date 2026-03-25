import prompts from 'prompts'

export async function promptForCredentials(defaultUsername?: string) {
  const response = await prompts([
    {
      type: 'text',
      name: 'username',
      message: 'Admin username',
      initial: defaultUsername,
      validate: value => value ? true : 'Username is required'
    },
    {
      type: 'password',
      name: 'password',
      message: 'Admin password',
      validate: value => value ? true : 'Password is required'
    }
  ], {
    onCancel: () => {
      throw new Error('Authentication cancelled')
    }
  })

  return {
    username: response.username as string,
    password: response.password as string
  }
}
